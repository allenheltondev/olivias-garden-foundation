/**
 * How a tool reaches the service that owns the data (docs/mcp-server.md,
 * "How tools reach the services").
 *
 * The MCP server holds no database connection and no business rules. A tool
 * invokes the owning service's existing API Lambda directly (IAM
 * `lambda:InvokeFunction`), with an API Gateway REST (v1) proxy event built
 * here. The event carries the authorizer context that service's own
 * authorizer would have attached for the operator, so the request runs the
 * exact code path an admin-app click does: same validation, idempotency,
 * audit rows, Stripe calls and domain events.
 *
 * Only an IAM principal allowed to invoke the function can deliver such an
 * event. Through API Gateway, `requestContext.authorizer` is written by
 * API Gateway itself and a client cannot set it.
 */

import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { ToolError } from './shared.mjs';

export const SERVICES = {
  admin: {
    label: 'admin API',
    env: 'ADMIN_API_FUNCTION',
    // services/admin-api/src/auth/authorizer.mjs
    authorizer: (op) => ({ principalId: op.sub, userId: op.sub, isAdmin: 'true' })
  },
  okra: {
    label: 'okra admin API',
    env: 'OKRA_ADMIN_API_FUNCTION',
    // services/okra-api/src/services/cognito-auth.mjs, authorizerContextFromPayload
    authorizer: (op) => ({ principalId: op.sub, sub: op.sub, groups: JSON.stringify(['admin']), email: op.email ?? '' })
  },
  store: {
    label: 'store API',
    env: 'STORE_API_FUNCTION',
    // services/store-api/src/services/auth.mjs, resolveOptionalAuthContext
    authorizer: (op) => ({ principalId: op.sub, userId: op.sub, isAdmin: 'true', email: op.email ?? '' })
  },
  grn: {
    label: 'Good Roots Network API',
    env: 'GRN_API_FUNCTION',
    // services/grn-api/src/auth/authorizer.rs, handle_jwt_auth
    authorizer: (op) => ({ principalId: op.sub, userId: op.sub, isAdmin: 'true', email: op.email ?? '' })
  }
};

function toQueryString(query) {
  const entries = Object.entries(query ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (entries.length === 0) return { single: null, multi: null };
  const single = Object.fromEntries(entries.map(([k, v]) => [k, String(v)]));
  const multi = Object.fromEntries(entries.map(([k, v]) => [k, [String(v)]]));
  return { single, multi };
}

/** A REST API (payload v1) proxy event for one request, as `service`'s authorizer would have passed it. */
export function buildProxyEvent(service, { method, path, query, body, operator, correlationId, idempotencyKey }) {
  const headers = {
    accept: 'application/json',
    'content-type': 'application/json',
    'user-agent': 'ogf-mcp',
    'x-correlation-id': correlationId,
    ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {})
  };
  const { single, multi } = toQueryString(query);
  return {
    resource: '/{proxy+}',
    path,
    httpMethod: method,
    headers,
    multiValueHeaders: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, [v]])),
    queryStringParameters: single,
    multiValueQueryStringParameters: multi,
    pathParameters: { proxy: path.replace(/^\//, '') },
    stageVariables: null,
    requestContext: {
      resourcePath: '/{proxy+}',
      httpMethod: method,
      path,
      stage: 'mcp',
      requestId: correlationId,
      requestTimeEpoch: Date.now(),
      protocol: 'HTTP/1.1',
      accountId: 'mcp',
      apiId: 'mcp-direct-invoke',
      identity: { sourceIp: '127.0.0.1', userAgent: 'ogf-mcp' },
      authorizer: SERVICES[service].authorizer(operator)
    },
    body: body === undefined ? null : JSON.stringify(body),
    isBase64Encoded: false
  };
}

/** The message a service put in its error body, in any of the shapes this repo's services use. */
export function errorMessage(parsed, fallback) {
  if (!parsed || typeof parsed !== 'object') return fallback;
  const candidates = [parsed.error?.message, parsed.message, typeof parsed.error === 'string' ? parsed.error : null];
  return candidates.find((c) => typeof c === 'string' && c.length > 0) ?? fallback;
}

/** Turn a service's proxy result into data, or a ToolError the model can read and act on. */
export function readProxyResult(serviceLabel, result) {
  const status = Number(result?.statusCode ?? 500);
  let parsed = null;
  if (typeof result?.body === 'string' && result.body.length > 0) {
    try {
      parsed = JSON.parse(result.body);
    } catch {
      parsed = null;
    }
  }
  if (status >= 200 && status < 300) return parsed ?? {};
  if (status >= 500) {
    throw new ToolError(`The ${serviceLabel} failed (${status}). Try again later.`);
  }
  throw new ToolError(`${status}: ${errorMessage(parsed, 'The request was refused.')}`);
}

/**
 * Invokes the services. `request(service, options)` returns the parsed JSON
 * body of a 2xx, and throws a ToolError for anything else.
 */
export class LambdaBackends {
  constructor({ functions, operator, correlationId, client, logger = console }) {
    this.functions = functions;
    this.operator = operator;
    this.correlationId = correlationId;
    this.client = client ?? new LambdaClient({});
    this.logger = logger;
  }

  has(service) {
    return Boolean(this.functions[service]);
  }

  async request(service, { method = 'GET', path, query, body, idempotencyKey } = {}) {
    const functionName = this.functions[service];
    const meta = SERVICES[service];
    if (!functionName) throw new ToolError(`The ${meta.label} is not connected in this environment.`);
    const event = buildProxyEvent(service, {
      method,
      path,
      query,
      body,
      operator: this.operator,
      correlationId: this.correlationId,
      idempotencyKey
    });
    const started = Date.now();
    const out = await this.client.send(new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify(event))
    }));
    const raw = out.Payload ? Buffer.from(out.Payload).toString('utf8') : '';
    let result = null;
    try {
      result = raw ? JSON.parse(raw) : null;
    } catch {
      result = null;
    }
    this.logger.info?.(JSON.stringify({
      level: 'INFO',
      msg: 'MCP backend call',
      correlationId: this.correlationId,
      service,
      method,
      path,
      status: out.FunctionError ? 'function_error' : result?.statusCode,
      ms: Date.now() - started
    }));
    if (out.FunctionError) {
      throw new ToolError(`The ${meta.label} failed. Correlation id: ${this.correlationId}.`);
    }
    return readProxyResult(meta.label, result);
  }
}

/** For tests: answers from a function `(service, event) => { statusCode, body }`. */
export class FakeBackends {
  constructor(respond, { operator, correlationId = 'test-correlation' } = {}) {
    this.respond = respond;
    this.operator = operator;
    this.correlationId = correlationId;
    this.calls = [];
    this.services = new Set(Object.keys(SERVICES));
  }
  has(service) {
    return this.services.has(service);
  }
  async request(service, options = {}) {
    const event = buildProxyEvent(service, {
      method: options.method ?? 'GET',
      ...options,
      operator: this.operator,
      correlationId: this.correlationId
    });
    this.calls.push({ service, event });
    return readProxyResult(SERVICES[service].label, await this.respond(service, event));
  }
}
