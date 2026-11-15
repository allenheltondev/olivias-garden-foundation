/**
 * The MCP endpoint (docs/mcp-server.md): `https://api.<domain>/mcp`.
 *
 * As kids-and-dragons' mcp/handler.ts: the 2026-07-28 Streamable HTTP
 * transport served statelessly by `@modelcontextprotocol/server`, one fresh
 * server per request bound to the caller's key, plain JSON answers, and the
 * SDK's stateless fallback for 2025-era clients. Browser origins are refused
 * (agents call from servers and send no Origin).
 *
 * Every request is checked here, not by an API Gateway authorizer (whose
 * cache would let a revoked key work for minutes): the key against its row,
 * then its operator against Cognito's admin group.
 */

import { randomUUID } from 'node:crypto';
import { createMcpHandler, originValidationResponse } from '@modelcontextprotocol/server';
import { bearerKey, verifyKey } from './keys.mjs';
import { buildServer } from './server.mjs';
import { createSeedPinLocator } from './seed-pins.mjs';

const MAX_BODY_BYTES = 1024 * 1024;

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
 * deps: { keys, operators, backendsFor(operator, correlationId), allowedOriginHosts?, logger?, geocode?, locateSeedPin? }
 *
 * The seed pin locator is made here, once per endpoint, so its cache and its
 * one-call-at-a-time queue span every request a warm container serves. Only
 * the key, its operator and the service calls are per request.
 */
export function mcpEndpoint(deps) {
  const logger = deps.logger ?? console;
  const locateSeedPin = deps.locateSeedPin ?? createSeedPinLocator(deps.geocode, { logger });
  const mcp = createMcpHandler(
    ({ authInfo }) => {
      const extra = authInfo?.extra;
      // Fail closed: nothing reaches the factory without a verified key.
      if (!extra?.key) throw new Error('MCP server built without a verified key');
      return buildServer(extra.key, { backends: extra.backends, logger, locateSeedPin });
    },
    {
      maxRequestBodySize: MAX_BODY_BYTES,
      onerror: (error) => logger.warn?.(JSON.stringify({ level: 'WARN', msg: 'MCP request rejected', error: error.message }))
    }
  );

  return async (request) => {
    const correlationId = request.headers.get('x-correlation-id') || randomUUID();
    const presented = bearerKey(request.headers.get('authorization'));
    const key = presented ? await verifyKey(deps.keys, presented) : null;
    if (!key) {
      return refusal(401, 'A live MCP key is required (Authorization: Bearer ogfmcp_…).', correlationId);
    }

    let isAdmin = false;
    try {
      isAdmin = await deps.operators.isAdmin(key.operator.username);
    } catch (error) {
      logger.error?.(JSON.stringify({
        level: 'ERROR',
        msg: 'Operator check failed',
        correlationId,
        keyId: key.id,
        error: error instanceof Error ? error.message : String(error)
      }));
      return refusal(503, 'Could not confirm the operator is still an admin. Try again shortly.', correlationId);
    }
    if (!isAdmin) {
      logger.warn?.(JSON.stringify({ level: 'WARN', msg: 'Operator no longer an admin', correlationId, keyId: key.id }));
      return refusal(403, "This key's operator is no longer an admin.", correlationId);
    }

    const rejected = originValidationResponse(request, deps.allowedOriginHosts ?? []);
    if (rejected) return rejected;

    logger.info?.(JSON.stringify({ level: 'INFO', msg: 'MCP request', correlationId, keyId: key.id, label: key.label }));
    const backends = deps.backendsFor(key.operator, correlationId);
    const response = await mcp.fetch(request, {
      authInfo: { token: '', clientId: key.id, scopes: key.scopes, extra: { key, backends } }
    });
    const headers = new Headers(response.headers);
    headers.set('x-correlation-id', correlationId);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  };
}
