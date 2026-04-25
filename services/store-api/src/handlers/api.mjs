import { Logger } from '@aws-lambda-powertools/logger';
import {
  errorResponse,
  getCorrelationId,
  jsonResponse,
  mapApiError,
  normalizeRoutePath,
  parseJsonBody
} from '../services/http.mjs';
import {
  getPublicProductBySlug,
  listPublicProducts
} from '../services/products.mjs';
import {
  createCheckoutSession,
  getOrderByStripeSession,
  handleStripeWebhook,
  listAdminOrders,
  listMyOrders
} from '../services/orders.mjs';

const logger = new Logger({ serviceName: 'store-api', logLevel: 'DEBUG' });

function getMethod(event) {
  return event?.requestContext?.http?.method ?? event?.httpMethod ?? 'GET';
}

function getPath(event) {
  return event?.rawPath ?? event?.path ?? '/';
}

function logRouteHit(route, event, correlationId) {
  logger.info('Route matched', {
    route,
    correlationId,
    method: getMethod(event),
    path: getPath(event)
  });
}

function matchProductBySlug(path) {
  const match = path.match(/^\/products\/([^/]+)$/);
  return match?.[1] ?? null;
}

function matchOrderBySession(path) {
  const match = path.match(/^\/orders\/by-session\/([^/]+)$/);
  return match?.[1] ?? null;
}

async function handleWebhook(event, correlationId) {
  const signature =
    event?.headers?.['stripe-signature'] ?? event?.headers?.['Stripe-Signature'];

  let rawBody = event?.body ?? '';
  if (event?.isBase64Encoded) {
    rawBody = Buffer.from(rawBody, 'base64').toString('utf8');
  }

  try {
    const result = await handleStripeWebhook(rawBody, signature);
    logger.info('Stripe webhook processed', { correlationId, result });
    return jsonResponse(200, { received: true, ...result }, correlationId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Stripe webhook failed', { correlationId, error: message });
    if (
      message.includes('signature') ||
      message.includes('Signature') ||
      message.includes('STRIPE_WEBHOOK_SECRET')
    ) {
      return errorResponse(400, 'Invalid Stripe webhook signature', correlationId);
    }
    return mapApiError(error, correlationId);
  }
}

export async function handler(event) {
  const correlationId = getCorrelationId(event);
  const method = getMethod(event);
  const rawPath = getPath(event);
  const path = normalizeRoutePath(rawPath);
  const normalizedEvent = { ...event, rawPath: path, path };

  logger.info('Request received', {
    correlationId,
    method,
    rawPath,
    path
  });

  if (method === 'OPTIONS') {
    return jsonResponse(200, {}, correlationId);
  }

  try {
    if (method === 'GET' && path === '/products') {
      logRouteHit('GET /products', normalizedEvent, correlationId);
      const result = await listPublicProducts();
      return jsonResponse(200, result, correlationId);
    }

    const productSlug = method === 'GET' ? matchProductBySlug(path) : null;
    if (productSlug) {
      logRouteHit(`GET /products/${productSlug}`, normalizedEvent, correlationId);
      const product = await getPublicProductBySlug(productSlug);
      return jsonResponse(200, product, correlationId);
    }

    const orderSessionId = method === 'GET' ? matchOrderBySession(path) : null;
    if (orderSessionId) {
      logRouteHit('GET /orders/by-session/:id', normalizedEvent, correlationId);
      const order = await getOrderByStripeSession(orderSessionId);
      return jsonResponse(200, order, correlationId);
    }

    if (method === 'POST' && path === '/checkout') {
      logRouteHit('POST /checkout', normalizedEvent, correlationId);
      const payload = parseJsonBody(normalizedEvent);
      const result = await createCheckoutSession(normalizedEvent, payload);
      return jsonResponse(200, result, correlationId);
    }

    if (method === 'POST' && path === '/webhook') {
      logRouteHit('POST /webhook', normalizedEvent, correlationId);
      return handleWebhook(normalizedEvent, correlationId);
    }

    if (method === 'GET' && path === '/orders') {
      logRouteHit('GET /orders', normalizedEvent, correlationId);
      const result = await listMyOrders(normalizedEvent);
      return jsonResponse(200, result, correlationId);
    }

    if (method === 'GET' && path === '/admin/orders') {
      logRouteHit('GET /admin/orders', normalizedEvent, correlationId);
      const result = await listAdminOrders(normalizedEvent);
      return jsonResponse(200, result, correlationId);
    }

    logger.warn('Route not matched', { correlationId, method, path });
    return errorResponse(404, 'Not Found', correlationId);
  } catch (error) {
    logger.error('Request handler returned error', {
      correlationId,
      method,
      path,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    return mapApiError(error, correlationId);
  }
}
