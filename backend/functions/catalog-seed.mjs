/**
 * CloudFormation custom resource Lambda that seeds the crops table
 * from OpenFarm's public crops.csv on stack create/update.
 *
 * Idempotent: uses ON CONFLICT (slug) DO UPDATE for safe re-runs.
 */

import pg from "pg";

const SOURCE_URL =
  "https://raw.githubusercontent.com/openfarmcc/OpenFarm/mainline/lib/crops.csv";
const MAX_RECORDS = 2000;
const BATCH_SIZE = 100;
const SOURCE_PROVIDER = "openfarmcc/openfarm";

// ── CSV parsing & normalization (shared logic with scripts/catalog/build_openfarm_seed.mjs) ──

function parseCsvLines(text) {
  const rows = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const fields = [];
    let i = 0;
    while (i < line.length) {
      if (line[i] === '"') {
        let end = i + 1;
        while (end < line.length) {
          if (line[end] === '"') {
            if (end + 1 < line.length && line[end + 1] === '"') {
              end += 2;
            } else {
              break;
            }
          } else {
            end++;
          }
        }
        fields.push(line.slice(i + 1, end).replace(/""/g, '"'));
        i = end + 2;
      } else {
        const next = line.indexOf(",", i);
        if (next === -1) {
          fields.push(line.slice(i));
          break;
        }
        fields.push(line.slice(i, next));
        i = next + 1;
      }
    }
    rows.push(fields);
  }
  return rows;
}

function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

function normalizeRows(rows) {
  const dedupe = new Map();
  for (const row of rows) {
    if (!row.length) continue;
    const scientific = (row[0] ?? "").trim();
    const common = (row[1] ?? "").trim();
    if (!scientific || scientific.startsWith("?")) continue;
    if (!common) continue;
    if (!scientific.includes(" ")) continue;
    const slug = slugify(common || scientific);
    if (!slug || dedupe.has(slug)) continue;
    dedupe.set(slug, {
      slug,
      common_name: common || scientific,
      scientific_name: scientific,
      source_url: SOURCE_URL,
      attribution_text: "OpenFarm community dataset (GitHub archive)",
    });
  }
  return [...dedupe.values()]
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .slice(0, MAX_RECORDS);
}

// ── Database seeding ──

async function seedDatabase(records, batchId) {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    await client.query("BEGIN");

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      const values = [];
      const params = [];
      let paramIdx = 1;

      for (const r of batch) {
        values.push(
          `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`
        );
        params.push(
          r.slug,
          r.common_name,
          r.scientific_name,
          SOURCE_PROVIDER,
          r.source_url,
          r.attribution_text,
          batchId
        );
      }

      await client.query(
        `INSERT INTO crops (slug, common_name, scientific_name, source_provider, source_url, attribution_text, import_batch_id)
         VALUES ${values.join(", ")}
         ON CONFLICT (slug) DO UPDATE SET
           common_name = EXCLUDED.common_name,
           scientific_name = EXCLUDED.scientific_name,
           source_provider = EXCLUDED.source_provider,
           source_url = EXCLUDED.source_url,
           attribution_text = EXCLUDED.attribution_text,
           import_batch_id = EXCLUDED.import_batch_id,
           imported_at = now(),
           updated_at = now()`,
        params
      );
    }

    await client.query("COMMIT");
    return records.length;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

// ── CloudFormation custom resource response ──

async function sendCfnResponse(event, status, reason, data) {
  const body = JSON.stringify({
    Status: status,
    Reason: reason || "",
    PhysicalResourceId: event.PhysicalResourceId || "catalog-seed",
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: data || {},
  });

  const resp = await fetch(event.ResponseURL, {
    method: "PUT",
    headers: { "Content-Type": "" },
    body,
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) {
    console.error(JSON.stringify({ level: "error", message: "CFN response failed", status: resp.status }));
  }
}

// ── Handler ──

export async function handler(event) {
  const requestType = event.RequestType;
  const batchId = `cfn-${event.RequestId || "manual"}`;

  console.log(JSON.stringify({
    level: "info",
    message: "Catalog seed invoked",
    requestType,
    batchId,
  }));

  // On Delete, nothing to do — we don't remove seeded data
  if (requestType === "Delete") {
    await sendCfnResponse(event, "SUCCESS", "No-op on delete");
    return;
  }

  try {
    const resp = await fetch(SOURCE_URL, {
      headers: { "User-Agent": "GRN-Catalog-Seed/1.0" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching CSV`);
    const body = await resp.text();
    const rows = parseCsvLines(body);
    const records = normalizeRows(rows);
    const count = await seedDatabase(records, batchId);

    console.log(JSON.stringify({
      level: "info",
      message: "Catalog seed complete",
      recordsUpserted: count,
      batchId,
    }));

    await sendCfnResponse(event, "SUCCESS", `Seeded ${count} crops`, { RecordsSeeded: count });
  } catch (err) {
    console.error(JSON.stringify({
      level: "error",
      message: "Catalog seed failed",
      error: err.message,
      batchId,
    }));
    await sendCfnResponse(event, "FAILED", err.message);
  }
}
