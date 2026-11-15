import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  createZoneLookup,
  findZoneRow,
  parsePostalInput,
  zoneNumber,
} from '../src/site/okra-guides/hardiness-zones.mjs';

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
  test('sends only the 5-digit ZIP to phzmapi and remembers the answer', async () => {
    const calls = [];
    const lookup = createZoneLookup(async (url) => {
      calls.push(url);
      return jsonResponse({ zone: '8b', temperature_range: '15 to 20' });
    });
    assert.deepEqual(await lookup('75070'), { status: 'found', zip: '75070', zone: '8b', zoneNumber: 8 });
    await lookup('75070');
    assert.deepEqual(calls, ['https://phzmapi.org/75070.json']);
  });

  test('ZIP codes outside the map data are not found', async () => {
    const missing = createZoneLookup(async () => new Response('', { status: 404 }));
    assert.deepEqual(await missing('99999'), { status: 'not-found', zip: '99999' });
    const noZone = createZoneLookup(async () => jsonResponse({ zone: '' }));
    assert.deepEqual(await noZone('99999'), { status: 'not-found', zip: '99999' });
  });

  test('a slow lookup times out instead of hanging', async () => {
    const lookup = createZoneLookup((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }), { timeoutMs: 10 });
    await assert.rejects(lookup('75070'), /Aborted/);
  });

  test('network failures are reported and not cached, so a retry works', async () => {
    let online = false;
    const lookup = createZoneLookup(async () => {
      if (!online) throw new TypeError('Failed to fetch');
      return jsonResponse({ zone: '8b' });
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
