import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Inline the pure functions from the handler so we can test without pg ─────

const GEO_PRECISIONS = [4, 5, 6];

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

function computeBucketStart(occurredAt) {
  const ts = Math.floor(new Date(occurredAt).getTime() / 1000);
  const bucket = 5 * 60;
  const floored = ts - ((ts % bucket) + bucket) % bucket;
  return new Date(floored * 1000);
}

function retentionDays(windowDays) {
  if (windowDays === 7) return 35;
  if (windowDays === 14) return 49;
  return 90;
}

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

// ── Tests ────────────────────────────────────────────────────────────────────

describe("parseEvent", () => {
  it("parses a listing.created event", () => {
    const detail = {
      listingId: "8b5a1a3e-d7ad-4ca4-9f56-2f188db4e6ef",
      occurredAt: "2026-02-20T21:00:00Z",
      correlationId: "corr-1",
    };
    const { domain, occurredAt, correlationId } = parseEvent("listing.created", detail);
    assert.equal(domain.type, "listing");
    assert.equal(domain.listingId, "8b5a1a3e-d7ad-4ca4-9f56-2f188db4e6ef");
    assert.equal(occurredAt, "2026-02-20T21:00:00Z");
    assert.equal(correlationId, "corr-1");
  });

  it("parses a request.updated event", () => {
    const detail = {
      requestId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      occurredAt: "2026-03-01T10:00:00Z",
      correlationId: "corr-2",
    };
    const { domain } = parseEvent("request.updated", detail);
    assert.equal(domain.type, "request");
    assert.equal(domain.requestId, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });

  it("parses a claim.created event", () => {
    const detail = {
      listingId: "11111111-1111-1111-1111-111111111111",
      requestId: "22222222-2222-2222-2222-222222222222",
      occurredAt: "2026-03-01T12:00:00Z",
      correlationId: "corr-3",
    };
    const { domain } = parseEvent("claim.created", detail);
    assert.equal(domain.type, "claim");
    assert.equal(domain.listingId, "11111111-1111-1111-1111-111111111111");
    assert.equal(domain.requestId, "22222222-2222-2222-2222-222222222222");
  });

  it("rejects unsupported detail type", () => {
    assert.throws(() => parseEvent("unknown.event", {}), /Unsupported detail type/);
  });

  it("defaults correlationId when missing", () => {
    const detail = { listingId: "8b5a1a3e-d7ad-4ca4-9f56-2f188db4e6ef" };
    const { correlationId } = parseEvent("listing.created", detail);
    assert.equal(correlationId, "unknown-correlation-id");
  });
});

describe("geoPrefixes", () => {
  it("returns expected precisions for a 7-char geohash", () => {
    const prefixes = geoPrefixes("9q8yyk8");
    assert.deepEqual(prefixes, ["9q8y", "9q8yy", "9q8yyk"]);
  });

  it("handles short geohash gracefully", () => {
    const prefixes = geoPrefixes("9q8");
    assert.deepEqual(prefixes, []);
  });

  it("normalizes to lowercase", () => {
    const prefixes = geoPrefixes("9Q8YYK8");
    assert.deepEqual(prefixes, ["9q8y", "9q8yy", "9q8yyk"]);
  });
});

describe("expandGeoScopes", () => {
  it("deduplicates duplicate events", () => {
    const cropId = "8b5a1a3e-d7ad-4ca4-9f56-2f188db4e6ef";
    const source = [
      { geoKey: "9q8yyk8", cropId },
      { geoKey: "9q8yyk8", cropId },
    ];
    const scopes = expandGeoScopes(source);
    const unique = new Set(scopes.map((s) => `${s.geoBoundaryKey}|${s.cropId ?? ""}`));
    // 3 prefixes x (crop + all-crops) = 6
    assert.equal(unique.size, 6);
  });

  it("includes both crop-specific and all-crops scopes", () => {
    const scopes = expandGeoScopes([{ geoKey: "9q8yyk8", cropId: "abc" }]);
    const withCrop = scopes.filter((s) => s.cropId === "abc");
    const withoutCrop = scopes.filter((s) => s.cropId === null);
    assert.equal(withCrop.length, 3);
    assert.equal(withoutCrop.length, 3);
  });
});

describe("computeBucketStart", () => {
  it("floors to 5-minute boundary", () => {
    const result = computeBucketStart("2026-02-20T21:03:19Z");
    assert.equal(result.toISOString(), "2026-02-20T21:00:00.000Z");
  });

  it("is deterministic for duplicate event replays", () => {
    const first = computeBucketStart("2026-02-20T21:03:19Z");
    const second = computeBucketStart("2026-02-20T21:03:19Z");
    assert.equal(first.getTime(), second.getTime());
  });

  it("handles exact boundary timestamps", () => {
    const result = computeBucketStart("2026-02-20T21:05:00Z");
    assert.equal(result.toISOString(), "2026-02-20T21:05:00.000Z");
  });
});

describe("retentionDays", () => {
  it("returns 35 for 7-day window", () => {
    assert.equal(retentionDays(7), 35);
  });

  it("returns 49 for 14-day window", () => {
    assert.equal(retentionDays(14), 49);
  });

  it("returns 90 for 30-day window", () => {
    assert.equal(retentionDays(30), 90);
  });
});
