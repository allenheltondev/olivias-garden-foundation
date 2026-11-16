/**
 * The grower MCP Lambda (docs/grn-mcp-server.md): `ANY /` on this stack's
 * REST API, mapped to `https://api.<domain>/grn-mcp`. Converts the REST API's
 * payload v1 event to a web Request and the Response back, as the operator
 * server's adapter does (services/mcp-api/src/handlers/mcp.mjs); everything
 * else is in ../handler.mjs.
 *
 * Its role needs nothing beyond writing logs: it calls the GRN API over HTTPS
 * with the grower's own key.
 */

import { grnMcpEndpoint } from '../handler.mjs';

let endpoint = null;

function live() {
  if (endpoint) return endpoint;
  const grnApiUrl = process.env.GRN_API_URL;
  if (!grnApiUrl) throw new Error('GRN_API_URL is not set');
  endpoint = grnMcpEndpoint({
    grnApiUrl,
    allowedOriginHosts: (process.env.MCP_ALLOWED_ORIGIN_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean)
  });
  return endpoint;
}

export async function handler(event) {
  return toResult(await live()(toRequest(event)));
}

function headerValue(headers, name) {
  const wanted = name.toLowerCase();
  const found = Object.entries(headers ?? {}).find(([k]) => k.toLowerCase() === wanted);
  return found ? found[1] : undefined;
}

/** REST API payload v1 → web Request. */
export function toRequest(event) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(event?.headers ?? {})) {
    if (value !== undefined && value !== null) headers.set(name, String(value));
  }
  const host = headerValue(event?.headers, 'host') ?? event?.requestContext?.domainName ?? 'localhost';
  const params = new URLSearchParams();
  for (const [name, values] of Object.entries(event?.multiValueQueryStringParameters ?? {})) {
    for (const value of values ?? []) params.append(name, value);
  }
  const query = params.toString() ? `?${params}` : '';
  const method = event?.httpMethod ?? 'POST';
  const hasBody = method !== 'GET' && method !== 'HEAD' && event?.body;
  const body = hasBody ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body) : undefined;
  return new Request(`https://${host}${event?.path ?? '/'}${query}`, { method, headers, body });
}

export async function toResult(response) {
  const headers = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  return { statusCode: response.status, headers, body: await response.text(), isBase64Encoded: false };
}
