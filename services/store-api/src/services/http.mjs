export const corsHeaders = {
  'access-control-allow-origin': process.env.ORIGIN ?? '*',
  'access-control-allow-headers':
    'Content-Type,Authorization,Idempotency-Key,X-Correlation-Id,X-Amz-Date,X-Api-Key,X-Amz-Security-Token,Stripe-Signature',
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

export function readRawBody(event) {
  const body = event?.body;

  if (body === undefined || body === null || body === '') {
    return '';
  }

  if (typeof body !== 'string') {
    return body;
  }

  // BinaryMediaTypes "*/*" on the API Gateway means API Gateway delivers
  // request bodies base64-encoded, including JSON bodies for /checkout.
  // Decode here so downstream code sees the original UTF-8 string.
  if (event.isBase64Encoded) {
    return Buffer.from(body, 'base64').toString('utf8');
  }

  return body;
}

export function parseJsonBody(event) {
  const raw = readRawBody(event);

  if (raw === '' || raw === null || raw === undefined) {
    throw new Error('Request body is required');
  }

  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (error) {
    throw new Error(`Invalid JSON body: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function mapApiError(error, correlationId) {
  const message = error instanceof Error ? error.message : String(error);

  if (
    message.includes('Invalid JSON body')
    || message.includes('Request body is required')
    || message.startsWith('Validation:')
    || message.includes('Cart is empty')
    || message.includes('Quantity must be')
    || message.includes('Mismatched currencies')
  ) {
    return errorResponse(400, message, correlationId);
  }

  if (message.includes('not found') || message.includes('Not Found')) {
    return errorResponse(404, message, correlationId);
  }

  if (message.includes('Missing userId in authorizer context') || message.includes('Authentication required')) {
    return errorResponse(401, message, correlationId);
  }

  if (message.includes('Forbidden:')) {
    return errorResponse(403, message, correlationId);
  }

  if (message.includes('is not configured') || message.includes('Service not configured')) {
    return errorResponse(503, 'Service not configured in this environment', correlationId);
  }

  return errorResponse(500, message, correlationId);
}
