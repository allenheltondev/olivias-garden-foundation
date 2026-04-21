import { Router } from '@aws-lambda-powertools/event-handler/http';
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
  createStoreProduct,
  listAdminProducts,
  listPublicProducts,
  updateStoreProduct
} from '../services/store.mjs';

const app = new Router();
const logger = new Logger({ serviceName: 'admin-api' });

app.get('/store/products', async ({ event }) => {
  const correlationId = getCorrelationId(event);

  try {
    const result = await listPublicProducts();
    return jsonResponse(200, result, correlationId);
  } catch (error) {
    return mapApiError(error, correlationId);
  }
});

app.get('/admin/store/products', async ({ event }) => {
  const correlationId = getCorrelationId(event);

  try {
    const result = await listAdminProducts(event);
    return jsonResponse(200, result, correlationId);
  } catch (error) {
    return mapApiError(error, correlationId);
  }
});

app.post('/admin/store/products', async ({ event }) => {
  const correlationId = getCorrelationId(event);

  try {
    const payload = parseJsonBody(event);
    const result = await createStoreProduct(event, payload);
    return jsonResponse(201, result, correlationId);
  } catch (error) {
    return mapApiError(error, correlationId);
  }
});

app.notFound(({ event }) => errorResponse(404, 'Not Found', getCorrelationId(event)));

function matchStoreProductUpdatePath(path) {
  const match = path.match(/^\/admin\/store\/products\/([^/]+)$/);
  return match?.[1] ?? null;
}

export async function handler(event, context) {
  const correlationId = getCorrelationId(event);
  const method = event?.requestContext?.http?.method ?? event?.httpMethod ?? 'GET';
  const rawPath = event?.rawPath ?? event?.path ?? '/';
  const normalizedPath = normalizeRoutePath(rawPath);
  const normalizedEvent = {
    ...event,
    rawPath: normalizedPath,
    path: normalizedPath
  };

  logger.info('Request received', {
    correlationId,
    method,
    rawPath,
    path: normalizedPath
  });

  if (method === 'OPTIONS') {
    return jsonResponse(200, {}, correlationId);
  }

  try {
    const productId =
      method === 'PUT' ? matchStoreProductUpdatePath(normalizedPath) : null;

    const response = productId
      ? jsonResponse(
          200,
          await updateStoreProduct(
            normalizedEvent,
            parseJsonBody(normalizedEvent),
            productId
          ),
          correlationId
        )
      : await app.resolve(normalizedEvent, context);

    logger.info('Response sent', {
      correlationId,
      method,
      path: normalizedPath,
      status: response?.statusCode ?? 200
    });

    return response;
  } catch (error) {
    logger.error('Request handler returned error', {
      correlationId,
      method,
      path: normalizedPath,
      error: error instanceof Error ? error.message : String(error)
    });

    return mapApiError(error, correlationId);
  }
}
