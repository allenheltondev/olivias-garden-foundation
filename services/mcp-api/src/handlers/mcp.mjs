/**
 * The MCP Lambda (docs/mcp-server.md): `ANY /` on this stack's REST API,
 * mapped to `https://api.<domain>/mcp`. Converts the REST API's payload v1
 * event to a web Request and the Response back; everything else is in
 * ../mcp/handler.mjs.
 *
 * Its role reads the keys table, asks Cognito whether an operator is still an
 * admin, and invokes the four services' API functions. It holds no database
 * connection.
 */

import { DynamoKeyStore } from '../mcp/dynamo-keys.mjs';
import { mcpEndpoint } from '../mcp/handler.mjs';
import { CognitoOperatorDirectory } from '../mcp/operator.mjs';
import { LambdaBackends, SERVICES } from '../mcp/backends.mjs';
import { LambdaClient } from '@aws-sdk/client-lambda';

let endpoint = null;

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function live() {
  if (endpoint) return endpoint;
  const lambda = new LambdaClient({});
  const functions = Object.fromEntries(
    Object.entries(SERVICES).map(([service, meta]) => [service, process.env[meta.env] || null])
  );
  endpoint = mcpEndpoint({
    keys: new DynamoKeyStore(required('MCP_KEYS_TABLE')),
    operators: new CognitoOperatorDirectory(required('USER_POOL_ID')),
    backendsFor: (operator, correlationId) => new LambdaBackends({ functions, operator, correlationId, client: lambda }),
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
  // The request's own Host, so the SDK sees the URL the caller used. Nothing is fetched from it.
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
