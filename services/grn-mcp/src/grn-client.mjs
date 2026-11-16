/**
 * Calls the Good Roots Network API as the grower, with their own key
 * (docs/grn-mcp-server.md, "How tools reach the API").
 *
 * Over the public API, through API Gateway, exactly as the grower's own script
 * would: the GRN authorizer checks the key, the key's usage plan throttles and
 * meters it, and every ownership and tier check in grn-api applies. The MCP
 * server adds no access of its own.
 */

export class ToolError extends Error {}

const TIMEOUT_MS = 25_000;

/** The message a GRN error body carries, in either shape the API uses. */
export function errorMessage(body, fallback) {
  if (!body || typeof body !== 'object') return fallback;
  const candidates = [body.error?.message, body.message, typeof body.error === 'string' ? body.error : null];
  return candidates.find((c) => typeof c === 'string' && c.length > 0) ?? fallback;
}

/** `/crops/{cropLibraryId}` with its parameters filled in, plus query and headers. */
export function buildRequest(operation, args = {}) {
  let path = operation.path;
  const query = new URLSearchParams();
  const headers = {};
  for (const parameter of operation.parameters) {
    const value = args[parameter.argument];
    if (value === undefined || value === null) {
      if (parameter.required) throw new ToolError(`${parameter.argument} is required.`);
      continue;
    }
    if (parameter.in === 'path') {
      path = path.replace(`{${parameter.name}}`, encodeURIComponent(String(value)));
    } else if (parameter.in === 'query') {
      for (const item of Array.isArray(value) ? value : [value]) query.append(parameter.name, String(item));
    } else {
      headers[parameter.name] = String(value);
    }
  }
  const search = query.toString();
  const hasBody = operation.body && args.body !== undefined;
  return {
    method: operation.method,
    path: search ? `${path}?${search}` : path,
    headers: { ...headers, ...(hasBody ? { 'content-type': operation.body.contentType } : {}) },
    body: hasBody ? JSON.stringify(args.body) : undefined
  };
}

export function createGrnClient({ baseUrl, key, correlationId, fetch: fetcher = fetch, logger = console }) {
  const root = baseUrl.replace(/\/+$/, '');

  /**
   * `label` names the call in logs: an operation id and route template, never
   * the filled-in path, which can carry a credential (a garden share token is
   * the path of get_shared_garden) or a grower's ids.
   */
  async function send(method, path, { headers = {}, body, label = { operation: null, route: null } } = {}) {
    const started = Date.now();
    let response;
    try {
      response = await fetcher(`${root}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${key}`,
          'x-correlation-id': correlationId,
          'user-agent': 'ogf-grn-mcp',
          ...headers
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
    } catch (error) {
      logger.warn?.(JSON.stringify({ level: 'WARN', msg: 'GRN API unreachable', correlationId, method, ...label, error: error?.name }));
      throw new ToolError('The Good Roots Network API did not answer. Try again shortly.');
    }
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    logger.info?.(JSON.stringify({ level: 'INFO', msg: 'GRN API call', correlationId, method, ...label, status: response.status, ms: Date.now() - started }));
    return { status: response.status, body: parsed };
  }

  return {
    send,
    async call(operation, args) {
      const request = buildRequest(operation, args);
      const { status, body } = await send(request.method, request.path, {
        ...request,
        label: { operation: operation.operationId, route: operation.path }
      });
      if (status >= 200 && status < 300) {
        if (body === null) return { ok: true, status };
        return Array.isArray(body) ? { items: body } : body;
      }
      if (status === 429) throw new ToolError('429: This key is over its rate limit. Wait a little and try again.');
      if (status >= 500) throw new ToolError(`The Good Roots Network API failed (${status}). Correlation id: ${correlationId}.`);
      throw new ToolError(`${status}: ${errorMessage(body, 'The request was refused.')}`);
    }
  };
}
