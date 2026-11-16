import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import generated from '../src/generated/operations.json' with { type: 'json' };
import { EXCLUDED, buildCatalog, inputSchemaFor, toolName } from '../src/catalog.mjs';
import { ToolError, buildRequest, errorMessage } from '../src/grn-client.mjs';
import { bearerKey, grnMcpEndpoint } from '../src/handler.mjs';
import { toRequest, toResult } from '../src/handlers/mcp.mjs';

const VERSION = '2026-07-28';
const KEY = `grnk_${'a1'.repeat(32)}`;
const OTHER_KEY = `grnk_${'b2'.repeat(32)}`;
const API = 'https://api.example.org/grn';
const quiet = { info() {}, warn() {}, error() {} };
const op = (id) => generated.operations.find((o) => o.operationId === id);

describe('the generated operations', () => {
  it('match the spec exactly (npm run generate keeps them in sync)', () => {
    const script = fileURLToPath(new URL('../scripts/generate-operations.mjs', import.meta.url));
    const out = execFileSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
    assert.match(out, /in sync/);
  });

  it('inline every $ref and translate OpenAPI-only keywords', () => {
    const text = JSON.stringify(generated);
    assert.equal(text.includes('$ref'), false);
    assert.equal(text.includes('"nullable"'), false);
  });
});

describe('the catalog', () => {
  const { tools, excluded } = buildCatalog();
  const names = tools.map((t) => t.name);

  it('offers every operation as a tool unless it is excluded with a reason', () => {
    assert.equal(tools.length + excluded.length, generated.operations.length);
    for (const { reason } of excluded) assert.ok(reason.length > 5);
  });

  it('leaves out everything that calls a model, and agent tasks', () => {
    for (const id of ['generateWeeklyPlan', 'generateGardenReview', 'getDerivedFeed', 'listAgentTasks', 'createAgentTask', 'updateAgentTaskStatus']) {
      assert.ok(id in EXCLUDED, id);
      assert.equal(names.includes(toolName(id)), false, id);
    }
    // Every operation the spec tags AI is excluded, so a new AI endpoint cannot slip in.
    for (const operation of generated.operations.filter((o) => o.tags.includes('AI'))) {
      assert.ok(operation.operationId in EXCLUDED, operation.operationId);
    }
  });

  it('never lets a key manage keys, nor reach admin endpoints', () => {
    for (const operation of generated.operations) {
      if (operation.path.startsWith('/me/api-keys') || operation.path.startsWith('/admin/')) {
        assert.ok(operation.operationId in EXCLUDED, operation.operationId);
      }
    }
  });

  it('refuses an exclusion for an operation the spec no longer has', () => {
    assert.throws(() => buildCatalog(generated.operations.filter((o) => o.operationId !== 'generateWeeklyPlan')), /no longer has: generateWeeklyPlan/);
  });

  it('names tools in snake_case, uniquely, and includes the ones the instructions mention', () => {
    assert.equal(toolName('listMyCrops'), 'list_my_crops');
    assert.equal(toolName('getMyGardenCanvas'), 'get_my_garden_canvas');
    assert.equal(new Set(names).size, names.length);
    for (const name of ['get_me', 'list_my_crops', 'list_my_beds', 'get_my_garden_canvas', 'get_journal', 'list_reminders', 'create_listing', 'discover_listings', 'create_claim', 'create_request']) {
      assert.ok(names.includes(name), name);
    }
  });

  it('annotates reads, deletes and idempotent writes', () => {
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    assert.equal(byName.list_my_crops.annotations.readOnlyHint, true);
    assert.equal(byName.delete_my_crop.annotations.destructiveHint, true);
    assert.equal(byName.create_listing.annotations.readOnlyHint, false);
    assert.equal(byName.create_listing.annotations.idempotentHint, true);
  });

  it('tells the assistant when other people will see a change, and how to retry safely', () => {
    const listing = tools.find((t) => t.name === 'create_listing');
    assert.match(listing.description, /Other growers can see the result/);
    assert.match(listing.description, /idempotencyKey/);
    assert.doesNotMatch(tools.find((t) => t.name === 'discover_listings').description, /Other growers can see/);
  });

  it('builds inputs from path, query and header parameters plus the body', () => {
    const schema = inputSchemaFor(op('createListing'));
    assert.ok(schema.properties.idempotencyKey);
    assert.ok(schema.properties.body.properties.title);
    assert.ok(schema.required.includes('body'));
    const crop = inputSchemaFor(op('getMyCrop'));
    assert.deepEqual(crop.required, ['cropLibraryId']);
  });
});

describe('building API requests', () => {
  it('fills path parameters, query, headers and body', () => {
    const request = buildRequest(op('updateCropHarvest'), {
      cropLibraryId: 'crop/1',
      harvestId: 'h 2',
      body: { quantity: 3 }
    });
    assert.equal(request.method, 'PUT');
    assert.equal(request.path, '/crops/crop%2F1/harvests/h%202');
    assert.equal(request.body, '{"quantity":3}');
    assert.equal(request.headers['content-type'], 'application/json');

    const listing = buildRequest(op('createListing'), { idempotencyKey: 'retry-1', body: { title: 'Zucchini' } });
    assert.equal(listing.headers['Idempotency-Key'], 'retry-1');
  });

  it('puts query parameters in the query string and skips the unset ones', () => {
    const discover = op('discoverListings');
    const required = Object.fromEntries(discover.parameters.filter((p) => p.required).map((p) => [p.argument, 'x']));
    const optional = discover.parameters.find((p) => p.in === 'query' && !p.required);
    const request = buildRequest(discover, required);
    assert.ok(request.path.startsWith('/listings/discover?'));
    assert.ok(!request.path.includes(`${optional.name}=`));
    assert.ok(buildRequest(discover, { ...required, [optional.argument]: 'y' }).path.includes(`${optional.name}=y`));
  });

  it('refuses a missing path parameter rather than calling a wrong URL', () => {
    assert.throws(() => buildRequest(op('getMyCrop'), {}), ToolError);
  });

  it('reads error messages in either shape the API uses', () => {
    assert.equal(errorMessage({ error: 'Not found' }, 'x'), 'Not found');
    assert.equal(errorMessage({ error: { message: 'Pro only' } }, 'x'), 'Pro only');
    assert.equal(errorMessage(null, 'fallback'), 'fallback');
  });
});

describe('the endpoint', () => {
  let calls;
  let routes;
  let clock;
  let endpoint;

  beforeEach(() => {
    calls = [];
    clock = 1_000_000;
    routes = {
      'GET /me': (auth) => (auth === `Bearer ${KEY}` ? [200, { id: 'grower-1', displayName: 'Sam' }] : [401, { error: 'Unauthorized' }])
    };
    endpoint = grnMcpEndpoint({
      grnApiUrl: `${API}/`,
      logger: quiet,
      now: () => clock,
      fetch: async (url, init) => {
        const path = url.replace(API, '').split('?')[0];
        calls.push({ url, init, path });
        const route = routes[`${init.method} ${path}`];
        if (!route) return new Response(JSON.stringify({ error: 'no route' }), { status: 404 });
        const [status, body] = route(init.headers.authorization, init);
        return new Response(body === undefined ? null : JSON.stringify(body), { status });
      }
    });
  });

  async function rpc(key, method, params = {}, headers = {}) {
    const res = await endpoint(new Request('https://api.example.org/grn-mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': VERSION,
        'mcp-method': method,
        ...(method === 'tools/call' ? { 'mcp-name': String(params.name) } : {}),
        ...(key ? { authorization: `Bearer ${key}` } : {}),
        ...headers
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': VERSION, 'io.modelcontextprotocol/clientCapabilities': {} } }
      })
    }));
    return { status: res.status, headers: res.headers, body: await res.json() };
  }
  const call = async (name, args = {}) => (await rpc(KEY, 'tools/call', { name, arguments: args })).body.result;

  it('refuses no key, a malformed key and a revoked key, with a pointer to Settings', async () => {
    const none = await rpc(null, 'tools/list');
    assert.equal(none.status, 401);
    assert.match(none.body.error.message, /Settings → API keys/);
    assert.equal((await rpc('not-a-key', 'tools/list')).status, 401);
    const revoked = await rpc(OTHER_KEY, 'tools/list');
    assert.equal(revoked.status, 401);
    assert.match(revoked.body.error.message, /revoked/);
    // A Cognito JWT is not accepted here: keys only.
    assert.equal((await rpc('eyJhbGciOiJSUzI1NiJ9.e30.sig', 'tools/list')).status, 401);
  });

  it('answers 503, not 401, when the API cannot be asked', async () => {
    routes['GET /me'] = () => [502, { error: 'bad gateway' }];
    assert.equal((await rpc(KEY, 'tools/list')).status, 503);
  });

  it('accepts a valid key whose grower has no profile yet', async () => {
    routes['GET /me'] = () => [404, { error: 'User not found' }];
    assert.equal((await rpc(KEY, 'tools/list')).status, 200);
  });

  it('lists every catalog tool', async () => {
    const { status, headers, body } = await rpc(KEY, 'tools/list');
    assert.equal(status, 200);
    assert.ok(headers.get('x-correlation-id'));
    assert.equal(body.result.tools.length, buildCatalog().tools.length);
  });

  it('checks a key once a minute, not on every request', async () => {
    await rpc(KEY, 'tools/list');
    await rpc(KEY, 'tools/list');
    assert.equal(calls.filter((c) => c.path === '/me').length, 1);
    clock += 61_000;
    await rpc(KEY, 'tools/list');
    assert.equal(calls.filter((c) => c.path === '/me').length, 2);
  });

  it('calls the API as the grower, with their key and the correlation id', async () => {
    routes['POST /listings'] = (_auth, init) => [201, { id: 'listing-1', ...JSON.parse(init.body) }];
    const result = await call('create_listing', {
      idempotencyKey: 'zucchini-1',
      body: {
        title: 'Zucchini',
        cropId: '0a0b0c0d-0000-4000-8000-000000000001',
        quantityTotal: 10,
        unit: 'lb',
        availableStart: '2026-07-01T00:00:00Z',
        availableEnd: '2026-07-08T00:00:00Z'
      }
    });
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.id, 'listing-1');
    const sent = calls.find((c) => c.path === '/listings');
    assert.equal(sent.init.method, 'POST');
    assert.equal(sent.init.headers.authorization, `Bearer ${KEY}`);
    assert.equal(sent.init.headers['Idempotency-Key'], 'zucchini-1');
    assert.ok(sent.init.headers['x-correlation-id']);
    assert.equal(JSON.parse(sent.init.body).title, 'Zucchini');
  });

  it('wraps a list response and reports an empty success', async () => {
    routes['GET /crops'] = () => [200, [{ id: 'c1' }]];
    routes['DELETE /beds/0a0b0c0d-0000-4000-8000-0000000000b1'] = () => [204, undefined];
    assert.deepEqual((await call('list_my_crops')).structuredContent, { items: [{ id: 'c1' }] });
    assert.deepEqual(
      (await call('delete_my_bed', { bedId: '0a0b0c0d-0000-4000-8000-0000000000b1' })).structuredContent,
      { ok: true, status: 204 }
    );
  });

  it('passes the API\'s refusals back readably, and hides server errors', async () => {
    routes['GET /analytics/pro/kpis'] = () => [403, { error: 'Pro plan required' }];
    routes['GET /reminders'] = () => [429, { message: 'Too Many Requests' }];
    routes['GET /journal'] = () => [500, { error: 'Database query error: secret detail' }];
    const pro = await call('get_pro_kpis');
    assert.equal(pro.isError, true);
    assert.match(pro.content[0].text, /403: Pro plan required/);
    assert.match((await call('list_reminders')).content[0].text, /rate limit/);
    const failed = await call('get_journal');
    assert.equal(failed.isError, true);
    assert.doesNotMatch(failed.content[0].text, /secret detail/);
  });

  it('rejects arguments that do not fit the spec without calling the API', async () => {
    const missing = await rpc(KEY, 'tools/call', { name: 'get_my_crop', arguments: {} });
    assert.ok(missing.body.error || missing.body.result.isError);
    const wrongType = await call('create_listing', { body: { title: 'Zucchini', cropId: 'x', quantityTotal: 'ten', unit: 'lb' } });
    assert.equal(wrongType.isError, true);
    assert.match(wrongType.content[0].text, /quantityTotal/);
    assert.equal(calls.some((c) => c.path.startsWith('/crops/') || c.path === '/listings'), false);
  });

  it('has no tools for what it leaves out', async () => {
    const result = await rpc(KEY, 'tools/call', { name: 'generate_weekly_plan', arguments: {} });
    assert.ok(result.body.error || result.body.result?.isError);
    assert.equal(calls.some((c) => c.path === '/almanac/weekly-plan'), false);
  });

  it('refuses browser origins', async () => {
    assert.equal((await rpc(KEY, 'tools/list', {}, { origin: 'https://evil.example' })).status, 403);
  });

  it('reads a bearer header', () => {
    assert.equal(bearerKey(`Bearer ${KEY}`), KEY);
    assert.equal(bearerKey('Basic abc'), null);
  });
});

describe('lambda adapter', () => {
  it('converts a REST v1 event to a Request and a Response back', async () => {
    const request = toRequest({
      httpMethod: 'POST',
      path: '/grn-mcp',
      headers: { Host: 'api.example.org' },
      multiValueQueryStringParameters: { a: ['1'] },
      body: '{"x":1}',
      isBase64Encoded: false
    });
    assert.equal(request.url, 'https://api.example.org/grn-mcp?a=1');
    assert.equal(await request.text(), '{"x":1}');
    const result = await toResult(new Response('{}', { status: 202 }));
    assert.equal(result.statusCode, 202);
  });
});
