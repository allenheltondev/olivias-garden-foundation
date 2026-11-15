import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { MemoryKeyStore, mintKey } from '../src/mcp/keys.mjs';
import { FakeBackends } from '../src/mcp/backends.mjs';
import { StaticOperatorDirectory } from '../src/mcp/operator.mjs';
import { mcpEndpoint } from '../src/mcp/handler.mjs';
import { seedRequestPage } from '../src/mcp/tools/queues.mjs';
import { buildSeedPinQueries, createSeedPinLocator, wantsMapPin } from '../src/mcp/seed-pins.mjs';

const VERSION = '2026-07-28';
const OPERATOR = { sub: '11111111-2222-4333-8444-555555555555', username: 'op-user', email: 'op@example.org' };
const quiet = { info() {}, warn() {}, error() {} };
const uuidFor = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A mailed request that may have a pin, created `day` days into 2026 (so ids and dates are out of order). */
function seedRequest(n, day, overrides = {}) {
  return {
    id: uuidFor(n),
    name: `Person ${n}`,
    email: `p${n}@example.org`,
    fulfillmentMethod: 'mail',
    shippingAddress: { line1: `${n} Secret St`, city: 'Austin', region: 'TX', postalCode: '78701', country: 'US' },
    createdAt: new Date(Date.UTC(2026, 0, day)).toISOString(),
    requestStatus: 'open',
    pinVisibility: 'anonymous',
    mapPin: null,
    ...overrides
  };
}

/**
 * The okra admin API's GET /requests as it behaves: newest first, then paged
 * (services/okra-api/src/handlers/seed-request-admin-routes.mjs).
 */
function okraRequestsRoute(requests, event) {
  const q = event.queryStringParameters ?? {};
  const limit = Math.min(Number(q.limit ?? 20), 100);
  const page = Number(q.page ?? 1);
  const all = requests
    .filter((r) => r.requestStatus === q.status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const start = (page - 1) * limit;
  return { statusCode: 200, body: JSON.stringify({ data: all.slice(start, start + limit), total: all.length, page, limit }) };
}

describe('seed request ordering', () => {
  // 23 requests whose ids are not in date order: day = (n * 7) % 23 + 1.
  const requests = Array.from({ length: 23 }, (_, i) => seedRequest(i + 1, ((i + 1) * 7) % 23 + 1));
  const byAge = [...requests].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((r) => r.id);
  const backends = new FakeBackends((_s, event) => okraRequestsRoute(requests, event), { operator: OPERATOR });

  it('pages oldest first across the service\'s newest-first pages, without gaps or repeats', async () => {
    const seen = [];
    for (let page = 1; page <= 5; page += 1) {
      const out = await seedRequestPage(backends, { status: 'open', page, limit: 5, order: 'oldest' });
      assert.equal(out.total, 23);
      seen.push(...out.data.map((r) => r.id));
    }
    assert.deepEqual(seen, byAge);
    const past = await seedRequestPage(backends, { status: 'open', page: 6, limit: 5, order: 'oldest' });
    assert.deepEqual(past.data, []);
  });

  it('keeps newest first as the default', async () => {
    const out = await seedRequestPage(backends, { status: 'open', page: 1, limit: 4 });
    assert.deepEqual(out.data.map((r) => r.id), [...byAge].reverse().slice(0, 4));
  });
});

describe('seed pin lookup', () => {
  const sent = (request) => JSON.stringify(buildSeedPinQueries(request).map((q) => q.query));
  const found = (lng, lat) => ({ ResultItems: [{ Position: [lng, lat] }] });

  it('sends only city-level fields for a mailed request, never street, name or email', () => {
    const queries = buildSeedPinQueries(seedRequest(1, 1));
    assert.deepEqual(queries.map((q) => q.precision), ['city', 'city']);
    assert.deepEqual(queries[0].query, { QueryComponents: { Locality: 'Austin', Region: 'TX', Country: 'US' } });
    assert.ok(!/Secret|Person|example\.org|Street|QueryText/.test(sent(seedRequest(1, 1))));
  });

  it('looks nothing up for a request that may not have a pin', () => {
    const none = seedRequest(1, 1, { pinVisibility: 'none' });
    assert.equal(wantsMapPin(none), false);
    assert.deepEqual(buildSeedPinQueries(none), []);
    assert.equal(wantsMapPin(seedRequest(2, 1, { fulfillmentMethod: 'in_person', pinAddress: null })), false);
  });

  it('looks up the street only for an in-person exchange with a map address', () => {
    const inPerson = seedRequest(1, 1, {
      fulfillmentMethod: 'in_person',
      pinAddress: { line1: '1 Market Sq', city: 'McKinney', region: 'TX', country: 'us' }
    });
    const [first] = buildSeedPinQueries(inPerson);
    assert.equal(first.precision, 'nearby');
    assert.deepEqual(first.query, { QueryText: '1 Market Sq, McKinney, TX', Filter: { IncludeCountries: ['US'] } });
  });

  it('asks Amazon Location for one result, intended for storage, and reads [lng, lat]', async () => {
    const commands = [];
    const client = { send: async (command) => { commands.push(command.input); return found(-97.74, 30.27); } };
    // The default provider, with its client swapped for a fake.
    const { GeoPlacesClient } = await import('@aws-sdk/client-geo-places');
    const original = GeoPlacesClient.prototype.send;
    GeoPlacesClient.prototype.send = function (command) {
      return client.send(command);
    };
    try {
      const locate = createSeedPinLocator(undefined, { logger: quiet });
      assert.deepEqual(await locate(seedRequest(1, 1)), { lat: 30.27, lng: -97.74, precision: 'city' });
    } finally {
      GeoPlacesClient.prototype.send = original;
    }
    assert.equal(commands.length, 1);
    assert.equal(commands[0].IntendedUse, 'Storage');
    assert.equal(commands[0].MaxResults, 1);
  });

  it('falls back to coarser queries and never throws', async () => {
    const calls = [];
    const locate = createSeedPinLocator(async (query) => {
      calls.push(query);
      if (calls.length === 1) throw Object.assign(new Error('throttled'), { name: 'ThrottlingException' });
      return found(-97.74, 30.27);
    }, { logger: quiet });
    assert.deepEqual(await locate(seedRequest(1, 1)), { lat: 30.27, lng: -97.74, precision: 'city' });
    assert.equal(calls.length, 2);
    assert.ok('PostalCode' in calls[1].QueryComponents);
    const nothing = createSeedPinLocator(async () => ({ ResultItems: [] }), { logger: quiet });
    assert.equal(await nothing(seedRequest(1, 1)), null);
  });

  it('shares identical lookups and runs calls one at a time under concurrency', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let calls = 0;
    const locate = createSeedPinLocator(async () => {
      calls += 1;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return found(-97.74, 30.27);
    }, { logger: quiet });
    const sameTown = Array.from({ length: 8 }, (_, i) => seedRequest(i + 1, 1));
    const otherTown = seedRequest(99, 1, { shippingAddress: { city: 'Plano', region: 'TX', postalCode: '75024', country: 'US' } });
    const results = await Promise.all([...sameTown, otherTown].map((r) => locate(r)));
    assert.ok(results.every((r) => r && r.precision === 'city'));
    assert.equal(calls, 2, 'one call per distinct town');
    assert.equal(maxInFlight, 1, 'never more than one call at once');
    await locate(seedRequest(50, 1));
    assert.equal(calls, 2, 'a later lookup for a known town is cached');
  });

  it('does not cache a failed call', async () => {
    let calls = 0;
    const locate = createSeedPinLocator(async () => {
      calls += 1;
      if (calls <= 2) throw new Error('down');
      return found(-97.74, 30.27);
    }, { logger: quiet });
    assert.equal(await locate(seedRequest(1, 1)), null);
    assert.deepEqual(await locate(seedRequest(1, 1)), { lat: 30.27, lng: -97.74, precision: 'city' });
  });
});

describe('queue tools', () => {
  let requests;
  let fake;
  let located;
  let locateResult;
  let endpoint;
  let key;

  beforeEach(async () => {
    requests = Array.from({ length: 30 }, (_, i) => seedRequest(i + 1, ((i + 1) * 11) % 30 + 1));
    located = [];
    locateResult = { lat: 30.27, lng: -97.74, precision: 'city' };
    const keys = new MemoryKeyStore();
    key = (await mintKey(keys, { label: 'agent', scopes: ['queues:write'], operator: OPERATOR })).key;
    endpoint = mcpEndpoint({
      keys,
      operators: new StaticOperatorDirectory([OPERATOR.username]),
      logger: quiet,
      locateSeedPin: async (request) => {
        located.push(request);
        return locateResult;
      },
      backendsFor: (operator, correlationId) => {
        fake = new FakeBackends((service, event) => respond(service, event), { operator, correlationId });
        return fake;
      }
    });
  });

  function respond(service, event) {
    if (service !== 'okra') return { statusCode: 200, body: JSON.stringify({ items: [], total: 0 }) };
    if (event.httpMethod === 'GET' && event.path === '/requests') return okraRequestsRoute(requests, event);
    if (event.httpMethod === 'GET' && event.path === '/submissions') return { statusCode: 200, body: '{"data":[],"total":0}' };
    const body = JSON.parse(event.body ?? '{}');
    const id = event.path.split('/')[2];
    const request = requests.find((r) => r.id === id);
    if (event.path.endsWith('/statuses')) {
      request.requestStatus = body.status;
      request.mapPin = body.map_location ? { locality: 'Austin, TX' } : null;
      return { statusCode: 200, body: JSON.stringify({ id, requestStatus: body.status, mapPin: request.mapPin }) };
    }
    if (event.path.endsWith('/map-pin')) {
      request.mapPin = { locality: 'Austin, TX' };
      return { statusCode: 200, body: JSON.stringify({ id, mapPin: request.mapPin }) };
    }
    return { statusCode: 404, body: '{}' };
  }

  async function call(name, args = {}) {
    const res = await endpoint(new Request('https://api.example.org/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': VERSION,
        'mcp-method': 'tools/call',
        'mcp-name': name,
        authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args, _meta: { 'io.modelcontextprotocol/protocolVersion': VERSION, 'io.modelcontextprotocol/clientCapabilities': {} } }
      })
    }));
    return (await res.json()).result;
  }

  const posts = () => fake.calls.filter((c) => c.event.httpMethod === 'POST').map((c) => ({ path: c.event.path, body: JSON.parse(c.event.body) }));

  it('whats_pending previews the open requests waiting longest', async () => {
    const out = (await call('whats_pending', { preview: 3 })).structuredContent;
    const oldest = [...requests].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, 3).map((r) => r.id);
    assert.equal(out.seed_requests.open, 30);
    assert.deepEqual(out.seed_requests.oldest.map((r) => r.id), oldest);
  });

  it('list_seed_requests can list oldest first', async () => {
    const out = (await call('list_seed_requests', { order: 'oldest', limit: 2 })).structuredContent;
    const oldest = [...requests].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, 2).map((r) => r.id);
    assert.deepEqual(out.data.map((r) => r.id), oldest);
    assert.equal(out.order, 'oldest');
  });

  it('marking a mailed request done looks up its city and pins it', async () => {
    const target = requests[17];
    const out = (await call('mark_seed_request_done', { id: target.id })).structuredContent;
    assert.deepEqual(located.map((r) => r.id), [target.id]);
    assert.deepEqual(posts(), [{ path: `/requests/${target.id}/statuses`, body: { status: 'handled', map_location: locateResult } }]);
    assert.equal(out.map_pin.placed, true);
  });

  it('says plainly when no pin could be placed, and add_seed_request_map_pin repairs it', async () => {
    const target = requests[3];
    locateResult = null;
    const done = (await call('mark_seed_request_done', { id: target.id })).structuredContent;
    assert.equal(done.requestStatus, 'handled');
    assert.equal(done.map_pin.placed, false);
    assert.match(done.map_pin.warning, /could not be found.*add_seed_request_map_pin/s);
    assert.equal('map_location' in posts()[0].body, false);

    // Still not findable: the repair tool says what to pass rather than doing nothing.
    const stillMissing = await call('add_seed_request_map_pin', { id: target.id });
    assert.equal(stillMissing.isError, true);
    assert.match(stillMissing.content[0].text, /map_location/);

    locateResult = { lat: 30.3, lng: -97.7, precision: 'city' };
    const repaired = (await call('add_seed_request_map_pin', { id: target.id })).structuredContent;
    assert.equal(repaired.map_pin.placed, true);
    assert.deepEqual(posts().at(-1), { path: `/requests/${target.id}/map-pin`, body: { map_location: locateResult } });

    const again = (await call('add_seed_request_map_pin', { id: target.id })).structuredContent;
    assert.match(again.map_pin.note, /already/);
  });

  it('uses a given map_location without a lookup', async () => {
    const target = requests[5];
    const given = { lat: 40, lng: -100, precision: 'city' };
    const out = (await call('mark_seed_request_done', { id: target.id, map_location: given })).structuredContent;
    assert.equal(located.length, 0);
    assert.deepEqual(posts()[0].body.map_location, given);
    assert.equal(out.map_pin.placed, true);
  });

  it('looks nothing up for a requester who was told they would get no pin', async () => {
    const target = requests[8];
    target.pinVisibility = 'none';
    const out = (await call('mark_seed_request_done', { id: target.id })).structuredContent;
    assert.equal(located.length, 0);
    assert.equal(out.map_pin.placed, false);
    assert.match(out.map_pin.reason, /told they would not get one/);
    const repair = (await call('add_seed_request_map_pin', { id: target.id })).structuredContent;
    assert.equal(repair.map_pin.placed, false);
    assert.equal(posts().filter((p) => p.path.endsWith('/map-pin')).length, 0);
  });
});
