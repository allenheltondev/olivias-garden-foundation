import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createZoneLookup,
  findZoneRow,
  HARDINESS_ZONE_EDITION,
  parsePostalInput,
  zoneNumber,
  zoneShardPath,
} from '../src/site/okra-guides/hardiness-zones.mjs';
import { parseZoneCsv, shardZones } from './build-hardiness-zones.mjs';

const dataDir = fileURLToPath(new URL(`../public/data/hardiness-zones/${HARDINESS_ZONE_EDITION}/`, import.meta.url));

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

describe('postal code input', () => {
  test('accepts 5-digit and ZIP+4 codes', () => {
    assert.deepEqual(parsePostalInput(' 75070 '), { kind: 'zip', zip: '75070' });
    assert.deepEqual(parsePostalInput('75070-1234'), { kind: 'zip', zip: '75070' });
    assert.deepEqual(parsePostalInput('00501'), { kind: 'zip', zip: '00501' });
  });

  test('recognizes Canadian postal codes', () => {
    assert.deepEqual(parsePostalInput('K1A 0B1'), { kind: 'canada' });
    assert.deepEqual(parsePostalInput('m5v3l9'), { kind: 'canada' });
  });

  test('rejects anything else', () => {
    for (const value of ['', '7507', '750701', 'McKinney, TX', '75070-12']) {
      assert.deepEqual(parsePostalInput(value), { kind: 'invalid' }, value);
    }
  });

  test('zone numbers come from the zone label', () => {
    assert.equal(zoneNumber('8b'), 8);
    assert.equal(zoneNumber('10a'), 10);
    assert.equal(zoneNumber('13b'), 13);
    assert.equal(zoneNumber('14a'), undefined);
    assert.equal(zoneNumber('8'), undefined);
    assert.equal(zoneNumber(undefined), undefined);
  });
});

describe('zone lookup', () => {
  test('fetches only the shard for the ZIP code, once', async () => {
    const calls = [];
    const lookup = createZoneLookup(async (path) => {
      calls.push(path);
      return jsonResponse({ 75069: '8b', 75070: '8b' });
    });
    assert.deepEqual(await lookup('75070'), { status: 'found', zip: '75070', zone: '8b', zoneNumber: 8 });
    assert.deepEqual(await lookup('75071'), { status: 'not-found', zip: '75071' });
    assert.deepEqual(calls, ['/data/hardiness-zones/2023/75.json']);
  });

  test('a missing shard (the SPA fallback page or a 404) means not found', async () => {
    const html = createZoneLookup(async () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    assert.deepEqual(await html('99999'), { status: 'not-found', zip: '99999' });
    const missing = createZoneLookup(async () => new Response('', { status: 404 }));
    assert.deepEqual(await missing('99999'), { status: 'not-found', zip: '99999' });
  });

  test('network failures are reported and not cached, so a retry works', async () => {
    let online = false;
    const lookup = createZoneLookup(async () => {
      if (!online) throw new TypeError('Failed to fetch');
      return jsonResponse({ 75070: '8b' });
    });
    await assert.rejects(lookup('75070'));
    online = true;
    assert.equal((await lookup('75070')).zone, '8b');
  });

  test('server errors are reported, not shown as a missing ZIP', async () => {
    const lookup = createZoneLookup(async () => new Response('', { status: 503 }));
    await assert.rejects(lookup('75070'), /503/);
  });

  test('finds the row for a zone number', () => {
    const block = { rows: [{ zones: [7, 8], plant: 'a' }, { zones: [9], plant: 'b' }] };
    assert.equal(findZoneRow(block, 8)?.plant, 'a');
    assert.equal(findZoneRow(block, 9)?.plant, 'b');
    assert.equal(findZoneRow(block, 3), undefined);
  });
});

describe('zone data files', () => {
  test('parses PRISM CSVs and shards them by the first two digits', () => {
    const pairs = parseZoneCsv('zipcode,zone,trange,zonetitle\n75070,8b,15 to 20,8b: 15 to 20\n00501,7b,5 to 10,7b: 5 to 10\n75002,8a,10 to 15,8a: 10 to 15\n');
    const shards = shardZones(pairs);
    assert.deepEqual([...shards.keys()], ['00', '75']);
    assert.deepEqual(shards.get('75'), { 75002: '8a', 75070: '8b' });
    assert.throws(() => parseZoneCsv('zip,zone\n75070,8b\n'), /Unexpected PRISM CSV header/);
    assert.throws(() => parseZoneCsv('zipcode,zone\n7507,8b\n'), /Bad row 2/);
  });

  test('the committed files are valid, small, and cover known ZIP codes', () => {
    const files = readdirSync(dataDir).filter((name) => name.endsWith('.json'));
    assert.ok(files.length >= 90, `expected about 99 shard files, found ${files.length}`);
    let total = 0;
    for (const name of files) {
      const raw = readFileSync(join(dataDir, name), 'utf8');
      assert.ok(raw.length < 16_000, `${name} is ${raw.length} bytes`);
      const shard = JSON.parse(raw);
      for (const [zip, zone] of Object.entries(shard)) {
        assert.equal(zip.slice(0, 2), name.slice(0, 2), `${zip} in ${name}`);
        assert.ok(zoneNumber(zone) !== undefined, `${zip} has zone ${zone}`);
        total += 1;
      }
    }
    assert.ok(total > 39_000, `only ${total} ZIP codes`);

    const zoneFor = (zip) => JSON.parse(readFileSync(join(dataDir, zoneShardPath(zip).split('/').pop()), 'utf8'))[zip];
    assert.equal(zoneFor('75070'), '8b'); // McKinney, Texas
    assert.equal(zoneFor('55401'), '5a'); // Minneapolis
    assert.equal(zoneFor('33101'), '11a'); // Miami
  });
});
