export const corsHeaders = {
  'access-control-allow-origin': process.env.ORIGIN ?? '*',
  'access-control-allow-headers': 'Content-Type,Authorization,Idempotency-Key,X-Correlation-Id,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
  'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
  'access-control-max-age': '3600'
};

export function getCorrelationId(event) {
  return (
    event?.headers?.['x-correlation-id']
    ?? event?.headers?.['X-Correlation-Id']
    ?? crypto.randomUUID()
  );
}

export function jsonResponse(statusCode, body, correlationId) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'x-correlation-id': correlationId,
      ...corsHeaders
    },
    body: JSON.stringify(body)
  };
}

export function errorResponse(statusCode, message, correlationId) {
  return jsonResponse(statusCode, { error: message }, correlationId);
}

export function normalizeRoutePath(path = '/') {
  if (path === '/api') {
    return '/';
  }

  if (path.startsWith('/api/')) {
    return path.slice(4);
  }

  return path;
}

export function mapApiError(error, correlationId) {
  const message = error instanceof Error ? error.message : String(error);

  if (
    message.includes('Invalid JSON body')
    || message.includes('Request body is required')
    || message.includes('mode must be one of')
    || message.includes('amountCents must be at least')
    || message.includes('returnUrl is required')
    || message.includes('returnUrl must be a valid absolute URL')
    || message.includes('returnUrl origin is not allowed')
    || message.includes('Invalid authorization header format')
    || message.includes('Authorization token is required')
  ) {
    return errorResponse(400, message, correlationId);
  }

  if (message.includes('Invalid access token')) {
    return errorResponse(401, message, correlationId);
  }

  if (message.includes('No uploaded avatar found')) {
    return errorResponse(404, message, correlationId);
  }

  if (message.includes('is not configured')) {
    return errorResponse(503, 'Service not configured in this environment', correlationId);
  }

  return errorResponse(500, message, correlationId);
}
