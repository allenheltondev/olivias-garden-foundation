import { corsHeaders, errorResponse } from './pagination.mjs';

function stripPrefix(path, prefix) {
  if (!path || !prefix) {
    return path;
  }

  if (path === prefix) {
    return '/';
  }

  if (path.startsWith(`${prefix}/`)) {
    return path.slice(prefix.length);
  }

  return path;
}

function normalizePath(path, stage, basePath) {
  // Strip both the stage and the API Gateway custom-domain base path so the
  // router resolves consistently whether the request arrives via the raw
  // invoke URL (path includes `/${stage}`) or the custom domain (path
  // includes the base path because REST API base-path mapping does not
  // strip it before invoking the integration).
  let normalized = path;
  if (stage) {
    normalized = stripPrefix(normalized, `/${stage}`);
  }
  if (basePath) {
    normalized = stripPrefix(normalized, basePath);
  }
  return normalized;
}

function hasHeader(headers = {}, name) {
  const expected = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === expected);
}

export function getCorrelationId(event = {}) {
  return (
    event.headers?.['x-correlation-id'] ??
    event.headers?.['X-Correlation-Id'] ??
    event.requestContext?.requestId ??
    'unknown'
  );
}

export function normalizeRouterEvent(event = {}, options = {}) {
  const normalizedPath = normalizePath(
    event.path ?? event.rawPath ?? event.requestContext?.path,
    event.requestContext?.stage,
    options.basePath
  );

  return {
    ...event,
    path: normalizedPath,
    requestContext: {
      ...event.requestContext,
      path: normalizedPath
    }
  };
}

function normalizeBody(response) {
  if (response.body === undefined || response.body === null) {
    return '';
  }

  if (typeof response.body === 'string') {
    return response.body;
  }

  return JSON.stringify(response.body);
}

async function coerceResponse(response) {
  if (response instanceof Response) {
    return {
      statusCode: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text(),
      isBase64Encoded: false
    };
  }

  return {
    ...response,
    headers: { ...(response?.headers ?? {}) },
    body: normalizeBody(response ?? {})
  };
}

async function finalizeResponse(response, event) {
  const normalized = await coerceResponse(response);
  const headers = { ...normalized.headers };

  for (const [name, value] of Object.entries(corsHeaders)) {
    if (!hasHeader(headers, name)) {
      headers[name] = value;
    }
  }

  if (!hasHeader(headers, 'x-correlation-id')) {
    headers['x-correlation-id'] = getCorrelationId(event);
  }

  if (normalized.body && !hasHeader(headers, 'content-type')) {
    headers['content-type'] = 'application/json';
  }

  return {
    statusCode: normalized.statusCode ?? 200,
    headers,
    multiValueHeaders: normalized.multiValueHeaders,
    body: normalized.body,
    isBase64Encoded: normalized.isBase64Encoded ?? false
  };
}

function logHandlerError(handlerName, error, event) {
  console.error(JSON.stringify({
    level: 'error',
    message: error instanceof Error ? error.message : String(error),
    errorName: error instanceof Error ? error.name : 'UnknownError',
    stack: error instanceof Error ? error.stack : undefined,
    handler: handlerName,
    correlationId: getCorrelationId(event),
    method: event?.httpMethod,
    path: event?.path
  }));
}

export function createHttpRouterHandler({ app, handlerName, basePath }) {
  return async (event, context) => {
    const normalizedEvent = {
      ...normalizeRouterEvent(event, { basePath }),
      lambdaContext: context
    };

    if (normalizedEvent.httpMethod === 'OPTIONS') {
      return finalizeResponse({ statusCode: 204, headers: {}, body: '' }, normalizedEvent);
    }

    try {
      const response = await app.resolve(normalizedEvent, context);
      return await finalizeResponse(response, normalizedEvent);
    } catch (error) {
      logHandlerError(handlerName, error, normalizedEvent);
      return finalizeResponse(
        errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred'),
        normalizedEvent
      );
    }
  };
}
