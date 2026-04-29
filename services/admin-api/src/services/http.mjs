export const corsHeaders = {
  'access-control-allow-origin': process.env.ORIGIN ?? '*',
  'access-control-allow-headers':
    'Content-Type,Authorization,Idempotency-Key,X-Correlation-Id,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
  'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
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

export function parseJsonBody(event) {
  const body = event?.body;

  if (body === undefined || body === null || body === '') {
    throw new Error('Request body is required');
  }

  try {
    return typeof body === 'string' ? JSON.parse(body) : body;
  } catch (error) {
    throw new Error(`Invalid JSON body: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function mapApiError(error, correlationId) {
  const message = error instanceof Error ? error.message : String(error);

  if (
    message.includes('Invalid JSON body')
    || message.includes('product id must be a valid UUID')
    || message.includes('Request body is required')
    || message.includes('slug must be lowercase kebab-case')
    || message.includes('name is required')
    || message.includes('kind must be one of')
    || message.includes('status must be one of')
    || message.includes('fulfillmentType must be one of')
    || message.includes('currency must be a 3-letter lowercase ISO code')
    || message.includes('unitAmountCents must be greater than or equal to 0')
    || message.includes('metadata must be a JSON object')
    || message.includes('contentType must be one of')
    || message.includes('contentLength must be')
    || message.includes('images must')
    || message.includes('each image must be an object')
    || message.includes('image id must be a valid UUID')
    || message.includes('image alt_text must')
  ) {
    return errorResponse(400, message, correlationId);
  }

  if (message.includes('Store product not found') || message.includes('Store product image not found')) {
    return errorResponse(404, message, correlationId);
  }

  if (
    message.includes('Idempotency-Key request is already in progress')
    || message.includes('Idempotency-Key was reused')
  ) {
    return errorResponse(409, message, correlationId);
  }

  if (message.includes('Missing userId in authorizer context')) {
    return errorResponse(401, message, correlationId);
  }

  if (message.includes('Forbidden:')) {
    return errorResponse(403, message, correlationId);
  }

  if (message.includes('is not configured')) {
    return errorResponse(503, 'Service not configured in this environment', correlationId);
  }

  return errorResponse(500, message, correlationId);
}
