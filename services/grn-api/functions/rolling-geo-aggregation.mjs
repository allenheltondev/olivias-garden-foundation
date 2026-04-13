import pg from "pg";

const { DATABASE_URL } = process.env;

const SUPPORTED_WINDOWS_DAYS = [7, 14, 30];
const GEO_PRECISIONS = [4, 5, 6];
const SCHEMA_VERSION = 1;

// ── event parsing ────────────────────────────────────────────────────────────

function parseEvent(detailType, detail) {
  switch (detailType) {
    case "listing.created":
    case "listing.updated":
      if (!detail.listingId) throw new Error(`Missing listingId in ${detailType}`);
      return {
        domain: { type: "listing", listingId: detail.listingId },
        occurredAt: detail.occurredAt ?? new Date().toISOString(),
        correlationId: detail.correlationId ?? "unknown-correlation-id",
      };
    case "request.created":
    case "request.updated":
      if (!detail.requestId) throw new Error(`Missing requestId in ${detailType}`);
      return {
        domain: { type: "request", requestId: detail.requestId },
        occurredAt: detail.occurredAt ?? new Date().toISOString(),
        correlationId: detail.correlationId ?? "unknown-correlation-id",
      };
    case "claim.created":
    case "claim.updated":
      return {
        domain: {
          type: "claim",
          listingId: detail.listingId ?? null,
          requestId: detail.requestId ?? null,
        },
        occurredAt: detail.occurredAt ?? new Date().toISOString(),
        correlationId: detail.correlationId ?? "unknown-correlation-id",
      };
    default:
      throw new Error(`Unsupported detail type: ${detailType}`);
  }
}

// ── geo helpers ──────────────────────────────────────────────────────────────

function geoPrefixes(geoKey) {
  const normalized = geoKey.trim().toLowerCase();
  return GEO_PRECISIONS.filter((p) => normalized.length >= p).map((p) =>
    normalized.slice(0, p)
  );
}

function expandGeoScopes(sourcePairs) {
  const seen = new Set();
  const scopes = [];
  for (const { geoKey, cropId } of sourcePairs) {
    for (const prefix of geoPrefixes(geoKey)) {
      for (const cid of [cropId, null]) {
        const key = `${prefix}|${cid ?? ""}`;
        if (!seen.has(key)) {
          seen.add(key);
          scopes.push({ geoBoundaryKey: prefix, cropId: cid });
        }
      }
    }
  }
  return scopes;
}

// ── scope resolution ─────────────────────────────────────────────────────────

async function loadListingScope(client, listingId) {
  const { rows } = await client.query(
    `SELECT geo_key, crop_id FROM surplus_listings
     WHERE id = $1 AND deleted_at IS NULL`,
    [listingId]
  );
  if (rows.length === 0 || !rows[0].geo_key) return null;
  return { geoKey: rows[0].geo_key, cropId: rows[0].crop_id ?? null };
}

async function loadRequestScope(client, requestId) {
  const { rows } = await client.query(
    `SELECT geo_key, crop_id FROM requests
     WHERE id = $1 AND deleted_at IS NULL`,
    [requestId]
  );
  if (rows.length === 0 || !rows[0].geo_key) return null;
  return { geoKey: rows[0].geo_key, cropId: rows[0].crop_id ?? null };
}

async function resolveScopes(client, domain) {
  const pairs = [];
  if (domain.type === "listing") {
    const s = await loadListingScope(client, domain.listingId);
    if (s) pairs.push(s);
  } else if (domain.type === "request") {
    const s = await loadRequestScope(client, domain.requestId);
    if (s) pairs.push(s);
  } else if (domain.type === "claim") {
    if (domain.listingId) {
      const s = await loadListingScope(client, domain.listingId);
      if (s) pairs.push(s);
    }
    if (domain.requestId) {
      const s = await loadRequestScope(client, domain.requestId);
      if (s) pairs.push(s);
    }
  }
  return expandGeoScopes(pairs);
}

// ── aggregation ──────────────────────────────────────────────────────────────

function computeBucketStart(occurredAt) {
  const ts = Math.floor(new Date(occurredAt).getTime() / 1000);
  const bucket = 5 * 60;
  const floored = ts - ((ts % bucket) + bucket) % bucket; // euclid mod
  return new Date(floored * 1000);
}

function retentionDays(windowDays) {
  if (windowDays === 7) return 35;
  if (windowDays === 14) return 49;
  return 90;
}

async function recomputeAndUpsert(client, scope, windowDays, bucketStart) {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowDays * 86_400_000);
  const expiresAt = new Date(now.getTime() + retentionDays(windowDays) * 86_400_000);
  const likePattern = `${scope.geoBoundaryKey}%`;

  const listingRow = (
    await client.query(
      `SELECT count(*)::int AS listing_count,
              coalesce(sum(quantity_remaining), 0)::float AS supply_quantity
       FROM surplus_listings
       WHERE deleted_at IS NULL
         AND status IN ('active', 'pending', 'claimed')
         AND created_at >= $1
         AND geo_key LIKE $2
         AND ($3::uuid IS NULL OR crop_id = $3)`,
      [windowStart, likePattern, scope.cropId]
    )
  ).rows[0];

  const requestRow = (
    await client.query(
      `SELECT count(*)::int AS request_count,
              coalesce(sum(quantity), 0)::float AS demand_quantity
       FROM requests
       WHERE deleted_at IS NULL
         AND status = 'open'
         AND created_at >= $1
         AND geo_key LIKE $2
         AND ($3::uuid IS NULL OR crop_id = $3)`,
      [windowStart, likePattern, scope.cropId]
    )
  ).rows[0];

  const listingCount = listingRow.listing_count;
  const requestCount = requestRow.request_count;
  const supplyQuantity = listingRow.supply_quantity;
  const demandQuantity = requestRow.demand_quantity;
  const scarcityScore = demandQuantity / (supplyQuantity + 1);
  const abundanceScore = supplyQuantity / (demandQuantity + 1);

  const signalPayload = JSON.stringify({ listingCount, requestCount, windowDays });

  await client.query(
    `SELECT upsert_derived_supply_signal(
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9,
       $10, $11, $12::jsonb,
       $13, $14
     )`,
    [
      SCHEMA_VERSION,
      scope.geoBoundaryKey,
      windowDays,
      bucketStart,
      scope.cropId,
      listingCount,
      requestCount,
      supplyQuantity,
      demandQuantity,
      scarcityScore,
      abundanceScore,
      signalPayload,
      now,
      expiresAt,
    ]
  );
}

// ── handler ──────────────────────────────────────────────────────────────────

export async function handler(event) {
  const detailType = event["detail-type"];
  const { domain, occurredAt, correlationId } = parseEvent(detailType, event.detail);

  const lagSeconds = Math.max(0, Math.floor((Date.now() - new Date(occurredAt).getTime()) / 1000));

  console.log(
    JSON.stringify({
      level: "INFO",
      message: "Received aggregation event",
      detailType,
      correlationId,
      processingLagSeconds: lagSeconds,
      metricName: "rolling_geo_aggregation.processing_lag_seconds",
      metricValue: lagSeconds,
    })
  );

  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const scopes = await resolveScopes(client, domain);
    if (scopes.length === 0) {
      console.log(
        JSON.stringify({
          level: "WARN",
          message: "No geo scopes resolved for event; skipping",
          detailType,
          correlationId,
        })
      );
      return;
    }

    const bucketStart = computeBucketStart(occurredAt);

    for (const scope of scopes) {
      for (const windowDays of SUPPORTED_WINDOWS_DAYS) {
        await recomputeAndUpsert(client, scope, windowDays, bucketStart);
      }
    }

    console.log(
      JSON.stringify({
        level: "INFO",
        message: "Completed rolling geo aggregation processing",
        detailType,
        correlationId,
        processingLagSeconds: lagSeconds,
      })
    );
  } finally {
    await client.end();
  }
}
