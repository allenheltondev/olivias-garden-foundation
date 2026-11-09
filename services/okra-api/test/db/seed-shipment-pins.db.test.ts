/**
 * Runs the seed pin projection SQL against a real Postgres, because the
 * ordering guarantees live in the ON CONFLICT ... WHERE clauses and can't be
 * meaningfully mocked.
 *
 * Needs OKRA_TEST_DATABASE_URL. The PR Okra Backend Tests job sets it, plus
 * OKRA_TEST_REQUIRE_DB=true so a missing database fails rather than skips.
 * Each run uses its own schema and drops it afterwards.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  getSeedShipmentPinsByRequestId,
  hideSeedShipmentPin,
  listSeedShipmentPins,
  upsertSeedShipmentPin,
} from '../../src/services/seed-shipment-pins.mjs';

const DATABASE_URL = process.env.OKRA_TEST_DATABASE_URL;
const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../db/migrations');
const schema = `seed_pins_test_${process.pid}_${Date.now()}`;

async function connect() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  await client.query(`SET search_path TO ${schema}`);
  return client;
}

async function applyMigration(client: pg.Client, file: string) {
  await client.query(await readFile(path.join(migrationsDir, file), 'utf-8'));
}

function pin(requestId: string, sourceVersion: number) {
  return {
    requestId,
    firstName: 'Jane',
    locality: 'Austin, TX',
    country: 'US',
    displayLat: 30.27,
    displayLng: -97.74,
    precision: 'city',
    sentAt: '2026-10-15T12:00:00.000Z',
    sourceVersion,
  };
}

// Locally (and in workflows without a Postgres service, like the production
// deploy) these skip without a database. The PR check job provides one and
// sets OKRA_TEST_REQUIRE_DB=true, so a missing URL there fails instead of
// silently skipping the only real check of the projection's ordering.
it.runIf(process.env.OKRA_TEST_REQUIRE_DB === 'true' && !DATABASE_URL)('has OKRA_TEST_DATABASE_URL when required', () => {
  throw new Error('OKRA_TEST_DATABASE_URL must be set when OKRA_TEST_REQUIRE_DB=true');
});

describe.skipIf(!DATABASE_URL)('seed_shipment_pins projection (real Postgres)', () => {
  let client: pg.Client;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();

    client = await connect();
    await applyMigration(client, '009_seed_shipment_pins.sql');
    // A pin written before consent/versioning existed must not stay public.
    await client.query(
      `INSERT INTO seed_shipment_pins (request_id, first_name, locality, country, display_lat, display_lng)
       VALUES ('legacy', 'Old', 'Somewhere, TX', 'US', 30, -97)`
    );
    await applyMigration(client, '010_seed_shipment_pin_versions.sql');
    await applyMigration(client, '011_seed_shipment_pin_precision.sql');
  });

  afterAll(async () => {
    await client?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client?.end();
  });

  beforeEach(async () => {
    await client.query(`DELETE FROM seed_shipment_pins WHERE request_id <> 'legacy'`);
  });

  it('hides pins written before consent was collected', async () => {
    const { rows } = await client.query(`SELECT * FROM seed_shipment_pins WHERE request_id = 'legacy'`);
    expect(rows[0]).toMatchObject({ visible: false, first_name: null, locality: null, display_lat: null });
    expect(await listSeedShipmentPins(client)).toEqual([]);
  });

  it('done then undo, in order: pin appears then disappears', async () => {
    expect(await upsertSeedShipmentPin(client, pin('r1', 1))).toBe(true);
    expect(await listSeedShipmentPins(client)).toHaveLength(1);

    expect(await hideSeedShipmentPin(client, 'r1', 2)).toBe(true);
    expect(await listSeedShipmentPins(client)).toEqual([]);
  });

  it('defaults existing pins to city precision, stores nearby pins, and rejects unknown precisions', async () => {
    const { rows } = await client.query(`SELECT precision FROM seed_shipment_pins WHERE request_id = 'legacy'`);
    expect(rows[0].precision).toBe('city');

    expect(await upsertSeedShipmentPin(client, { ...pin('near', 1), precision: 'nearby', displayLat: 30.267, displayLng: -97.743 })).toBe(true);
    const stored = await client.query(`SELECT precision FROM seed_shipment_pins WHERE request_id = 'near'`);
    expect(stored.rows[0].precision).toBe('nearby');

    await expect(
      upsertSeedShipmentPin(client, { ...pin('bad', 1), precision: 'exact' })
    ).rejects.toThrow(/seed_shipment_pins_precision_valid/);
  });

  it('fuzzes a nearby pin within ~500 m of where it was stored', async () => {
    await upsertSeedShipmentPin(client, { ...pin('near2', 1), precision: 'nearby', displayLat: 30.267, displayLng: -97.743 });

    const [published] = await listSeedShipmentPins(client);
    // Nearby pins use the 0.005 degree radius, not the 0.05 city radius.
    expect(Math.hypot(published.display_lat - 30.267, published.display_lng + 97.743)).toBeLessThanOrEqual(0.005 + 1e-9);
  });

  it('undo lands before the done insert: the late insert is rejected', async () => {
    // The reported race: undo commits and hides before "handled" inserts.
    expect(await hideSeedShipmentPin(client, 'r2', 2)).toBe(false);
    expect(await upsertSeedShipmentPin(client, pin('r2', 1))).toBe(false);

    expect(await listSeedShipmentPins(client)).toEqual([]);
    const { rows } = await client.query(`SELECT visible, source_version, first_name FROM seed_shipment_pins WHERE request_id = 'r2'`);
    expect(rows[0]).toEqual({ visible: false, source_version: '2', first_name: null });
  });

  it('done again after an undo shows the pin at the newest version', async () => {
    await upsertSeedShipmentPin(client, pin('r3', 1));
    await hideSeedShipmentPin(client, 'r3', 2);
    expect(await upsertSeedShipmentPin(client, pin('r3', 3))).toBe(true);

    const pins = await getSeedShipmentPinsByRequestId(client, ['r3']);
    expect(pins.get('r3')).toEqual({ locality: 'Austin, TX', country: 'US', sourceVersion: 3 });
  });

  it('hiding an outdated pin at its own version still lets a newer pin write land', async () => {
    await upsertSeedShipmentPin(client, pin('r6', 1));
    // The admin list found this pin behind its request and hid it at the pin's own version.
    expect(await hideSeedShipmentPin(client, 'r6', 1)).toBe(true);
    expect(await getSeedShipmentPinsByRequestId(client, ['r6'])).toEqual(new Map());
    // The pin write for the request's newer version, in flight meanwhile, is not blocked.
    expect(await upsertSeedShipmentPin(client, pin('r6', 2))).toBe(true);
    expect((await getSeedShipmentPinsByRequestId(client, ['r6'])).get('r6')).toMatchObject({ sourceVersion: 2 });
  });

  it('replaying the same version is a no-op', async () => {
    expect(await upsertSeedShipmentPin(client, pin('r4', 1))).toBe(true);
    expect(await upsertSeedShipmentPin(client, { ...pin('r4', 1), firstName: 'Changed' })).toBe(false);
    const { rows } = await client.query(`SELECT first_name FROM seed_shipment_pins WHERE request_id = 'r4'`);
    expect(rows[0].first_name).toBe('Jane');
  });

  it('concurrent done/undo from separate connections always ends hidden', async () => {
    const a = await connect();
    const b = await connect();
    try {
      for (let i = 0; i < 25; i++) {
        const id = `race-${i}`;
        // Alternate which write is issued first to vary arrival order.
        const writes = i % 2 === 0
          ? [upsertSeedShipmentPin(a, pin(id, 1)), hideSeedShipmentPin(b, id, 2)]
          : [hideSeedShipmentPin(b, id, 2), upsertSeedShipmentPin(a, pin(id, 1))];
        await Promise.all(writes);

        const { rows } = await client.query(
          `SELECT visible, source_version FROM seed_shipment_pins WHERE request_id = $1`,
          [id]
        );
        expect(rows).toEqual([{ visible: false, source_version: '2' }]);
      }
      expect(await listSeedShipmentPins(client)).toEqual([]);
    } finally {
      await a.end();
      await b.end();
    }
  });

  it('refuses a visible pin without coordinates', async () => {
    await expect(
      upsertSeedShipmentPin(client, { ...pin('r5', 1), displayLat: null as unknown as number })
    ).rejects.toThrow(/seed_shipment_pins_visible_has_coords/);
  });
});
