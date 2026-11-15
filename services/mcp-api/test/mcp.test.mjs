import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { MemoryKeyStore, KeyError, bearerKey, listKeys, mintKey, revokeKey, verifyKey } from '../src/mcp/keys.mjs';
import { FakeBackends, buildProxyEvent, readProxyResult, LambdaBackends } from '../src/mcp/backends.mjs';
import { StaticOperatorDirectory } from '../src/mcp/operator.mjs';
import { mcpEndpoint } from '../src/mcp/handler.mjs';
import { toRequest, toResult } from '../src/handlers/mcp.mjs';
import { mergeProductUpdate } from '../src/mcp/tools/store.mjs';
import { mergeWorkshopUpdate } from '../src/mcp/tools/workshops.mjs';
import { runKeysCli } from '../scripts/keys.mjs';

const VERSION = '2026-07-28';
const OPERATOR = { sub: '11111111-2222-4333-8444-555555555555', username: 'op-user', email: 'op@example.org' };
const quiet = { info() {}, warn() {}, error() {} };

describe('keys', () => {
  let store;
  beforeEach(() => {
    store = new MemoryKeyStore();
  });

  it('mints a key shown once, stores only a hash, and verifies it as its operator', async () => {
    const { key, info } = await mintKey(store, { label: 'laptop', scopes: ['store:write'], operator: OPERATOR });
    assert.match(key, /^ogfmcp_[0-9a-f]{16}\.[A-Za-z0-9_-]{43}$/);
    assert.ok(!JSON.stringify(store.rows.get(info.id)).includes(key.split('.')[1]));
    assert.equal('secretHash' in info, false);
    const verified = await verifyKey(store, key);
    assert.deepEqual(verified.operator, OPERATOR);
    assert.deepEqual(verified.scopes, ['store:write']);
    assert.notEqual(store.rows.get(info.id).lastUsedAt, null);
  });

  it('refuses a wrong secret, a malformed key, an expired key and a revoked one alike', async () => {
    const now = new Date('2026-11-11T00:00:00Z');
    const { key, info } = await mintKey(store, { label: 'a', scopes: ['store:read'], operator: OPERATOR, days: 1, now });
    const [head, secret] = key.split('.');
    const flipped = `${head}.${secret[0] === 'A' ? 'B' : 'A'}${secret.slice(1)}`;
    assert.equal(await verifyKey(store, flipped, now), null);
    assert.equal(await verifyKey(store, 'ogfmcp_nope', now), null);
    assert.equal(await verifyKey(store, key, new Date('2026-11-12T00:00:01Z')), null);
    assert.notEqual(await verifyKey(store, key, now), null);
    await revokeKey(store, info.id);
    assert.equal(await verifyKey(store, key, now), null);
    await assert.rejects(() => revokeKey(store, info.id), KeyError);
  });

  it('refuses unknown scopes, no scopes, no operator, bad labels and silly lifetimes', async () => {
    await assert.rejects(() => mintKey(store, { label: 'a', scopes: ['store:admin'], operator: OPERATOR }), /Unknown scope/);
    await assert.rejects(() => mintKey(store, { label: 'a', scopes: [], operator: OPERATOR }), /at least one scope/);
    await assert.rejects(() => mintKey(store, { label: 'a', scopes: ['store:read'] }), /admin user/);
    await assert.rejects(() => mintKey(store, { label: 'a', scopes: ['store:read'], operator: { ...OPERATOR, sub: 'x' } }), /UUID/);
    await assert.rejects(() => mintKey(store, { label: 'Ann <ann@example.org>', scopes: ['store:read'], operator: OPERATOR }), /plain words/);
    await assert.rejects(() => mintKey(store, { label: 'a', scopes: ['store:read'], operator: OPERATOR, days: 0 }), /days/);
    await assert.rejects(() => mintKey(store, { label: 'a', scopes: ['store:read'], operator: OPERATOR, days: 400 }), /days/);
  });

  it('expands all:read and all:write, and lists keys without hashes', async () => {
    await mintKey(store, { label: 'reader', scopes: ['all:read'], operator: OPERATOR, now: new Date('2026-01-01T00:00:00Z') });
    await mintKey(store, { label: 'writer', scopes: ['all:write', 'store:write'], operator: OPERATOR, now: new Date('2026-02-01T00:00:00Z') });
    const keys = await listKeys(store);
    assert.deepEqual(keys.map((k) => k.label), ['reader', 'writer']);
    assert.deepEqual(keys[0].scopes, ['content:read', 'queues:read', 'reports:read', 'store:read', 'workshops:read']);
    assert.equal(keys[1].scopes.length, 5);
    assert.ok(!JSON.stringify(keys).includes('secretHash'));
  });

  it('reads a bearer header', () => {
    assert.equal(bearerKey('Bearer ogfmcp_x.y'), 'ogfmcp_x.y');
    assert.equal(bearerKey('bearer  ogfmcp_x.y '), 'ogfmcp_x.y');
    assert.equal(bearerKey('Basic abc'), null);
    assert.equal(bearerKey(undefined), null);
  });
});

describe('backend events', () => {
  it('carries each service\'s own authorizer context for the operator', () => {
    const base = { method: 'GET', path: '/x', operator: OPERATOR, correlationId: 'cid-1' };
    assert.deepEqual(buildProxyEvent('admin', base).requestContext.authorizer, { principalId: OPERATOR.sub, userId: OPERATOR.sub, isAdmin: 'true' });
    const okra = buildProxyEvent('okra', base).requestContext.authorizer;
    assert.equal(okra.sub, OPERATOR.sub);
    assert.deepEqual(JSON.parse(okra.groups), ['admin']);
    assert.equal(buildProxyEvent('store', base).requestContext.authorizer.isAdmin, 'true');
    assert.equal(buildProxyEvent('grn', base).requestContext.authorizer.userId, OPERATOR.sub);
  });

  it('builds a REST v1 proxy event with correlation id, idempotency key, query and JSON body', () => {
    const event = buildProxyEvent('admin', {
      method: 'POST',
      path: '/admin/store/products',
      query: { status: 'open', page: 2, empty: undefined },
      body: { a: 1 },
      operator: OPERATOR,
      correlationId: 'cid-2',
      idempotencyKey: 'retry-123456'
    });
    assert.equal(event.httpMethod, 'POST');
    assert.equal(event.path, '/admin/store/products');
    assert.equal(event.headers['x-correlation-id'], 'cid-2');
    assert.equal(event.headers['idempotency-key'], 'retry-123456');
    assert.deepEqual(event.queryStringParameters, { status: 'open', page: '2' });
    assert.deepEqual(event.multiValueQueryStringParameters, { status: ['open'], page: ['2'] });
    assert.equal(event.body, '{"a":1}');
    assert.equal(buildProxyEvent('admin', { method: 'GET', path: '/x', operator: OPERATOR, correlationId: 'c' }).queryStringParameters, null);
  });

  it('turns service errors into messages the model can act on', () => {
    assert.deepEqual(readProxyResult('admin API', { statusCode: 200, body: '{"ok":true}' }), { ok: true });
    assert.deepEqual(readProxyResult('admin API', { statusCode: 204, body: '' }), {});
    assert.throws(() => readProxyResult('admin API', { statusCode: 400, body: '{"error":"slug must be lowercase kebab-case"}' }), /400: slug must be lowercase/);
    assert.throws(() => readProxyResult('okra', { statusCode: 409, body: '{"error":{"code":"INVALID_STATE","message":"already handled"}}' }), /409: already handled/);
    assert.throws(() => readProxyResult('admin API', { statusCode: 500, body: '{"error":"Database query error: secret detail"}' }), (e) => !e.message.includes('secret detail'));
  });

  it('invokes the function and reports a function error without its internals', async () => {
    const sent = [];
    const client = {
      async send(command) {
        sent.push(command.input);
        if (sent.length === 1) return { Payload: Buffer.from(JSON.stringify({ statusCode: 200, body: '{"items":[]}' })) };
        return { FunctionError: 'Unhandled', Payload: Buffer.from('{"errorMessage":"boom"}') };
      }
    };
    const backends = new LambdaBackends({ functions: { admin: 'arn:admin' }, operator: OPERATOR, correlationId: 'cid', client, logger: quiet });
    assert.deepEqual(await backends.request('admin', { path: '/admin/workshops' }), { items: [] });
    assert.equal(sent[0].FunctionName, 'arn:admin');
    assert.equal(JSON.parse(Buffer.from(sent[0].Payload).toString()).requestContext.authorizer.userId, OPERATOR.sub);
    await assert.rejects(() => backends.request('admin', { path: '/x' }), (e) => /failed/.test(e.message) && !/boom/.test(e.message));
    await assert.rejects(() => backends.request('okra', { path: '/x' }), /not connected/);
  });
});

describe('merge updates', () => {
  const product = {
    id: 'p1', slug: 'tee', name: 'Tee', short_description: null, description: 'd', status: 'active', kind: 'merchandise',
    fulfillment_type: 'shipping', is_public: true, is_featured: false, currency: 'usd', unit_amount_cents: 2000,
    statement_descriptor: null, nonprofit_program: null, impact_summary: null,
    image_url: 'https://cdn/derived.jpg', legacy_image_url: null, metadata: { a: 1 },
    variations: [{ name: 'Size', values: ['S', 'M'] }],
    images: [{ id: 'img-1', sort_order: 0, alt_text: 'front', variation_match: {}, url: 'https://cdn/1.jpg' }]
  };

  it('keeps images, options and the stored image url when only the price changes', () => {
    const payload = mergeProductUpdate(product, { unit_amount_cents: 2500, name: undefined });
    assert.equal(payload.unit_amount_cents, 2500);
    assert.equal(payload.name, 'Tee');
    assert.equal(payload.image_url, null);
    assert.deepEqual(payload.images, [{ id: 'img-1', sort_order: 0, alt_text: 'front', variation_match: {} }]);
    assert.deepEqual(payload.variations, product.variations);
    assert.equal('id' in payload, false);
  });

  it('replaces images in the order given', () => {
    const payload = mergeProductUpdate(product, { images: [{ id: 'img-2' }, { id: 'img-1', alt_text: 'x' }] });
    assert.deepEqual(payload.images.map((i) => [i.id, i.sort_order]), [['img-2', 0], ['img-1', 1]]);
  });

  it('merges workshop changes over the current workshop', () => {
    const payload = mergeWorkshopUpdate(
      { id: 'w', slug: 's', title: 'T', status: 'open', is_paid: true, price_cents: 2500, currency: 'usd', capacity: 10, signup_counts: {} },
      { status: 'closed' }
    );
    assert.equal(payload.status, 'closed');
    assert.equal(payload.price_cents, 2500);
    assert.equal(payload.capacity, 10);
    assert.equal('signup_counts' in payload, false);
  });
});

describe('the endpoint', () => {
  let keys;
  let operators;
  let fake;
  let endpoint;
  let responder;

  beforeEach(() => {
    keys = new MemoryKeyStore();
    operators = new StaticOperatorDirectory([OPERATOR.username]);
    responder = () => ({ statusCode: 200, body: '{}' });
    endpoint = mcpEndpoint({
      keys,
      operators,
      logger: quiet,
      backendsFor: (operator, correlationId) => {
        fake = new FakeBackends((service, event) => responder(service, event), { operator, correlationId });
        return fake;
      }
    });
  });

  async function rpc(key, method, params = {}, headers = {}) {
    const res = await endpoint(new Request('https://api.example.org/mcp', {
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

  const call = async (key, name, args = {}) => (await rpc(key, 'tools/call', { name, arguments: args })).body.result;
  const toolNames = async (key) => (await rpc(key, 'tools/list')).body.result.tools.map((t) => t.name).sort();
  const mint = async (scopes) => (await mintKey(keys, { label: 'agent', scopes, operator: OPERATOR })).key;

  it('refuses no key, a bad key, a revoked key, and a key whose operator lost admin', async () => {
    assert.equal((await rpc(null, 'tools/list')).status, 401);
    assert.equal((await rpc('ogfmcp_aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'tools/list')).status, 401);
    const { key, info } = await mintKey(keys, { label: 'agent', scopes: ['store:read'], operator: OPERATOR });
    const ok = await rpc(key, 'tools/list');
    assert.equal(ok.status, 200);
    assert.ok(ok.headers.get('x-correlation-id'));
    operators.admins.delete(OPERATOR.username);
    assert.equal((await rpc(key, 'tools/list')).status, 403);
    operators.admins.add(OPERATOR.username);
    await revokeKey(keys, info.id);
    assert.equal((await rpc(key, 'tools/list')).status, 401);
  });

  it('refuses with 503 when the operator cannot be checked', async () => {
    const key = await mint(['store:read']);
    operators.isAdmin = async () => {
      throw new Error('cognito down');
    };
    assert.equal((await rpc(key, 'tools/list')).status, 503);
  });

  it('refuses browser origins', async () => {
    const key = await mint(['store:read']);
    assert.equal((await rpc(key, 'tools/list', {}, { origin: 'https://evil.example' })).status, 403);
  });

  it('advertises the 2026-07-28 revision', async () => {
    const { status, body } = await rpc(await mint(['reports:read']), 'server/discover');
    assert.equal(status, 200);
    assert.ok(body.result.supportedVersions.includes(VERSION));
  });

  it('registers only the tools a key\'s scopes reach', async () => {
    assert.deepEqual(await toolNames(await mint(['store:read'])), ['get_store_product', 'list_store_orders', 'list_store_products', 'whoami']);
    const write = await toolNames(await mint(['store:write']));
    assert.ok(write.includes('create_store_product') && write.includes('archive_store_product'));
    assert.deepEqual(await toolNames(await mint(['reports:read'])), ['get_dashboard_stats', 'get_revenue', 'list_activity', 'whoami']);
    const queues = await toolNames(await mint(['queues:read']));
    assert.ok(queues.includes('whats_pending') && !queues.includes('mark_seed_request_done'));

    const readKey = await mint(['queues:read']);
    const refused = await rpc(readKey, 'tools/call', { name: 'mark_seed_request_done', arguments: { id: OPERATOR.sub } });
    assert.ok(refused.body.error?.code ?? refused.body.result?.isError);
    assert.equal(fake.calls.length, 0);
  });

  it('every tool says whether it only reads', async () => {
    const { body } = await rpc(await mint(['all:write']), 'tools/list');
    assert.ok(body.result.tools.length >= 30);
    for (const tool of body.result.tools) {
      assert.equal(typeof tool.annotations?.readOnlyHint, 'boolean', tool.name);
      assert.ok(tool.description.length > 20, tool.name);
    }
  });

  it('whoami names the operator by email only', async () => {
    const result = await call(await mint(['store:read']), 'whoami');
    assert.deepEqual(result.structuredContent.operator, { email: OPERATOR.email });
    assert.ok(!JSON.stringify(result).includes(OPERATOR.sub));
  });

  it('marks a seed request done through the okra admin API, as the operator', async () => {
    responder = () => ({ statusCode: 200, body: JSON.stringify({ id: OPERATOR.sub, requestStatus: 'handled' }) });
    const result = await call(await mint(['queues:write']), 'mark_seed_request_done', {
      id: OPERATOR.sub,
      review_notes: 'Mailed Tuesday',
      map_location: { lat: 30.1, lng: -97.7, precision: 'city' }
    });
    assert.equal(result.structuredContent.requestStatus, 'handled');
    const [{ service, event }] = fake.calls;
    assert.equal(service, 'okra');
    assert.equal(event.httpMethod, 'POST');
    assert.equal(event.path, `/requests/${OPERATOR.sub}/statuses`);
    assert.deepEqual(JSON.parse(event.body), { status: 'handled', review_notes: 'Mailed Tuesday', map_location: { lat: 30.1, lng: -97.7, precision: 'city' } });
    assert.equal(event.requestContext.authorizer.sub, OPERATOR.sub);
  });

  it('updates a product by merging with the current one', async () => {
    const id = '0a0b0c0d-0000-4000-8000-000000000001';
    const current = {
      id, slug: 'tee', name: 'Tee', status: 'active', kind: 'merchandise', fulfillment_type: 'shipping',
      is_public: true, is_featured: false, currency: 'usd', unit_amount_cents: 2000, metadata: {}, variations: [],
      legacy_image_url: null, images: [{ id: '0a0b0c0d-0000-4000-8000-0000000000aa', sort_order: 0, alt_text: null, variation_match: {} }]
    };
    responder = (_service, event) => {
      if (event.httpMethod === 'GET') return { statusCode: 200, body: JSON.stringify({ items: [current] }) };
      return { statusCode: 200, body: JSON.stringify({ ...current, ...JSON.parse(event.body) }) };
    };
    const result = await call(await mint(['store:write']), 'update_store_product', { id, unit_amount_cents: 2400, idempotency_key: 'price-bump-1' });
    assert.equal(result.isError, undefined);
    const put = fake.calls.find((c) => c.event.httpMethod === 'PUT').event;
    assert.equal(put.path, `/admin/store/products/${id}`);
    assert.equal(put.headers['idempotency-key'], 'price-bump-1');
    const body = JSON.parse(put.body);
    assert.equal(body.unit_amount_cents, 2400);
    assert.equal(body.images.length, 1);
    assert.equal(body.name, 'Tee');
  });

  it('passes a service\'s validation message back as a tool error', async () => {
    responder = () => ({ statusCode: 400, body: JSON.stringify({ error: 'slug must be lowercase kebab-case' }) });
    const result = await call(await mint(['store:write']), 'create_store_product', {
      slug: 'ok-slug', name: 'X', kind: 'merchandise', fulfillment_type: 'shipping', unit_amount_cents: 100
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /slug must be lowercase/);
    assert.equal(JSON.parse(fake.calls[0].event.body).status, 'draft');
  });

  it('rejects bad arguments without calling the service', async () => {
    const result = await rpc(await mint(['store:write']), 'tools/call', {
      name: 'create_store_product',
      arguments: { slug: 'Not A Slug', name: 'X', kind: 'nope', fulfillment_type: 'shipping', unit_amount_cents: -1 }
    });
    assert.ok(result.body.error || result.body.result.isError);
    assert.equal(fake.calls.length, 0);
  });

  it('will not delete a workshop unless the slug confirms it', async () => {
    const id = '0a0b0c0d-0000-4000-8000-000000000002';
    responder = (_s, event) => (event.httpMethod === 'GET'
      ? { statusCode: 200, body: JSON.stringify({ id, slug: 'spring-planting' }) }
      : { statusCode: 200, body: JSON.stringify({ deleted: true, id }) });
    const key = await mint(['workshops:write']);
    const wrong = await call(key, 'delete_workshop', { id, confirm_slug: 'fall-harvest' });
    assert.equal(wrong.isError, true);
    assert.equal(fake.calls.some((c) => c.event.httpMethod === 'DELETE'), false);
    const right = await call(key, 'delete_workshop', { id, confirm_slug: 'spring-planting' });
    assert.equal(right.structuredContent.deleted, true);
  });

  it('whats_pending reports each queue, and a failing service without failing the rest', async () => {
    responder = (service, event) => {
      if (service === 'grn') return { statusCode: 500, body: '{}' };
      if (event.path === '/requests') return { statusCode: 200, body: JSON.stringify({ data: [{ id: 'r1' }, { id: 'r2' }], total: 7 }) };
      return { statusCode: 200, body: JSON.stringify({ data: [{ id: 's1' }], total: 1 }) };
    };
    const result = await call(await mint(['queues:read']), 'whats_pending', { preview: 1 });
    const out = result.structuredContent;
    assert.equal(out.seed_requests.open, 7);
    assert.equal(out.seed_requests.oldest.length, 1);
    assert.equal(out.okra_submissions.pending, 1);
    assert.match(out.api_access_requests.error, /failed/);
  });
});

describe('lambda adapter', () => {
  it('converts a REST v1 event to a Request and a Response back', async () => {
    const request = toRequest({
      httpMethod: 'POST',
      path: '/mcp',
      headers: { Host: 'api.example.org', 'Content-Type': 'application/json' },
      multiValueQueryStringParameters: { a: ['1', '2'] },
      body: Buffer.from('{"x":1}').toString('base64'),
      isBase64Encoded: true
    });
    assert.equal(request.url, 'https://api.example.org/mcp?a=1&a=2');
    assert.equal(await request.text(), '{"x":1}');
    const result = await toResult(new Response('{"ok":true}', { status: 201, headers: { 'x-a': 'b' } }));
    assert.equal(result.statusCode, 201);
    assert.equal(result.headers['x-a'], 'b');
    assert.equal(result.body, '{"ok":true}');
  });
});

describe('keys CLI', () => {
  it('mints only for an admin found by email, and prints the key once', async () => {
    const store = new MemoryKeyStore();
    const lines = [];
    const io = { out: (l) => lines.push(l), err: (l) => lines.push(l) };
    const directory = {
      async findByEmail(email) {
        return email === OPERATOR.email ? OPERATOR : null;
      },
      async isAdmin(username) {
        return username === OPERATOR.username;
      }
    };
    const tables = [];
    const deps = {
      openStore: (table) => {
        tables.push(table);
        return store;
      },
      openDirectory: () => directory,
      resolveUserPool: async () => 'pool',
      resolveTable: async (env) => `table-from-ogf-mcp-${env}`
    };
    assert.equal(await runKeysCli(['create', '--env', 'dev', '--label', 'laptop', '--operator', OPERATOR.email, '--scope', 'all:read'], deps, io), 0);
    assert.ok(lines.some((l) => /^\s+ogfmcp_/.test(l)));
    assert.equal(store.rows.size, 1);
    assert.equal(await runKeysCli(['create', '--env', 'dev', '--label', 'x', '--operator', 'stranger@example.org', '--scope', 'store:read'], deps, io), 1);
    assert.equal(await runKeysCli(['list'], deps, io), 2);
    const [id] = store.rows.keys();
    assert.equal(await runKeysCli(['revoke', '--env', 'dev', id], deps, io), 0);
    assert.equal(store.rows.size, 0);
    assert.ok(tables.every((t) => t === 'table-from-ogf-mcp-dev'));
    assert.equal(await runKeysCli(['list', '--table', 'explicit'], deps, io), 0);
    assert.equal(tables.at(-1), 'explicit');
  });
});
