/**
 * The grower MCP endpoint (docs/grn-mcp-server.md): `https://api.<domain>/grn-mcp`.
 *
 * Built like the operator server (services/mcp-api/src/mcp/handler.mjs): the
 * 2026-07-28 Streamable HTTP transport served statelessly, one fresh server
 * per request bound to the caller, the SDK's stateless fallback for 2025-era
 * clients, and browser origins refused.
 *
 * The caller is a grower holding a GRN API key (`grnk_…`, self-serve in the
 * app's settings). The key is checked by asking the GRN API who it belongs to
 * (`GET /me`), so revoking it in the app stops it here too; a successful check
 * is remembered for a minute per container, and every tool call is checked by
 * the API again regardless.
 */

import { createHash, randomUUID } from 'node:crypto';
import { createMcpHandler, originValidationResponse } from '@modelcontextprotocol/server';
import { createGrnClient } from './grn-client.mjs';
import { buildServer } from './server.mjs';

const MAX_BODY_BYTES = 1024 * 1024;
const KEY_SHAPE = /^grnk_[A-Za-z0-9]{16,128}$/;
const VERIFIED_TTL_MS = 60_000;
const VERIFIED_LIMIT = 1000;

export function bearerKey(header) {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
  return match ? match[1] : null;
}

function refusal(status, message, correlationId) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message } }), {
    status,
    headers: {
      'content-type': 'application/json',
      'x-correlation-id': correlationId,
      ...(status === 401 ? { 'www-authenticate': 'Bearer' } : {})
    }
  });
}

/**
 * deps: { grnApiUrl, fetch?, allowedOriginHosts?, logger?, now? }
 */
export function grnMcpEndpoint(deps) {
  const logger = deps.logger ?? console;
  const now = deps.now ?? Date.now;
  const verified = new Map();

  const mcp = createMcpHandler(
    ({ authInfo }) => {
      const client = authInfo?.extra?.client;
      // Fail closed: nothing reaches the factory without a checked key.
      if (!client) throw new Error('GRN MCP server built without a checked key');
      return buildServer({ client, logger });
    },
    {
      maxRequestBodySize: MAX_BODY_BYTES,
      onerror: (error) => logger.warn?.(JSON.stringify({ level: 'WARN', msg: 'MCP request rejected', error: error.message }))
    }
  );

  /** 'valid', 'invalid' or 'unavailable', for this key, asking the API at most once a minute. */
  async function check(key, client, keyId) {
    const cached = verified.get(keyId);
    if (cached && cached > now()) return 'valid';
    const { status } = await client
      .send('GET', '/me', { label: { operation: 'getMe', route: '/me' } })
      .catch(() => ({ status: 0 }));
    // 404 is a valid key whose grower has not set up a profile yet.
    if ((status >= 200 && status < 300) || status === 404) {
      if (verified.size >= VERIFIED_LIMIT) verified.delete(verified.keys().next().value);
      verified.set(keyId, now() + VERIFIED_TTL_MS);
      return 'valid';
    }
    verified.delete(keyId);
    return status === 401 || status === 403 ? 'invalid' : 'unavailable';
  }

  return async (request) => {
    const correlationId = request.headers.get('x-correlation-id') || randomUUID();
    const key = bearerKey(request.headers.get('authorization'));
    if (!key || !KEY_SHAPE.test(key)) {
      return refusal(401, 'A Good Roots Network API key is required (Authorization: Bearer grnk_…). Create one in Settings → API keys.', correlationId);
    }
    // Logs name a key by a short hash, never the key.
    const keyId = createHash('sha256').update(key).digest('hex').slice(0, 12);
    const client = createGrnClient({ baseUrl: deps.grnApiUrl, key, correlationId, fetch: deps.fetch, logger });

    const verdict = await check(key, client, keyId);
    if (verdict === 'invalid') {
      logger.warn?.(JSON.stringify({ level: 'WARN', msg: 'GRN key refused', correlationId, keyId }));
      return refusal(401, 'This API key is not valid. It may have been revoked; create a new one in Settings → API keys.', correlationId);
    }
    if (verdict === 'unavailable') {
      return refusal(503, 'Could not check the API key just now. Try again shortly.', correlationId);
    }

    const rejected = originValidationResponse(request, deps.allowedOriginHosts ?? []);
    if (rejected) return rejected;

    logger.info?.(JSON.stringify({ level: 'INFO', msg: 'GRN MCP request', correlationId, keyId }));
    const response = await mcp.fetch(request, { authInfo: { token: '', clientId: keyId, scopes: [], extra: { client } } });
    const headers = new Headers(response.headers);
    headers.set('x-correlation-id', correlationId);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  };
}
