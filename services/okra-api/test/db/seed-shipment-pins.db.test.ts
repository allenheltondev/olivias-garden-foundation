/**
 * Runs the seed pin projection SQL against a real Postgres, because the
 * ordering guarantees live in the ON CONFLICT ... WHERE clauses and can't be
 * meaningfully mocked.
 *
 * Needs OKRA_TEST_DATABASE_URL (CI sets it on the Okra Backend Tests job).
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
    sentAt: '2026-10-15T12:00:00.000Z',
    sourceVersion,
  };
}

// Locally these skip without a database; in CI a skip would hide the only
// real check of the projection's ordering, so fail instead.
it.runIf(Boolean(process.env.CI) && !DATABASE_URL)('has OKRA_TEST_DATABASE_URL in CI', () => {
  throw new Error('OKRA_TEST_DATABASE_URL must be set in CI so the seed pin projection runs against Postgres');
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
    expect(pins.get('r3')).toEqual({ locality: 'Austin, TX', country: 'US' });
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
