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
  archiveStoreProduct,
  createStoreProduct,
  listAdminProducts,
  listPublicProducts,
  updateStoreProduct
} from '../services/store.mjs';
import {
  completeStoreProductImageUpload,
  createStoreProductImageUploadIntent
} from '../services/store-images.mjs';

const app = new Router();
const logger = new Logger({ serviceName: 'admin-api', logLevel: 'DEBUG' });

function logRouteHit(route, event) {
  logger.info('Route matched', {
    route,
    correlationId: getCorrelationId(event),
    method: event?.requestContext?.http?.method ?? event?.httpMethod,
    path: event?.rawPath ?? event?.path,
    authorizer: event?.requestContext?.authorizer
  });
}

app.get('/store/products', async ({ event }) => {
  const correlationId = getCorrelationId(event);
  logRouteHit('GET /store/products', event);

  try {
    const result = await listPublicProducts();
    logger.debug('GET /store/products result', { itemCount: result?.items?.length });
    return jsonResponse(200, result, correlationId);
  } catch (error) {
    logger.error('GET /store/products failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : 'UnknownError',
      stack: error instanceof Error ? error.stack : undefined
    });
    return mapApiError(error, correlationId);
  }
});

app.get('/admin/store/products', async ({ event }) => {
  const correlationId = getCorrelationId(event);
  logRouteHit('GET /admin/store/products', event);

  try {
    const result = await listAdminProducts(event);
    logger.debug('GET /admin/store/products result', { itemCount: result?.items?.length });
    return jsonResponse(200, result, correlationId);
  } catch (error) {
    logger.error('GET /admin/store/products failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : 'UnknownError',
      stack: error instanceof Error ? error.stack : undefined
    });
    return mapApiError(error, correlationId);
  }
});

app.post('/admin/store/products', async ({ event }) => {
  const correlationId = getCorrelationId(event);
  logRouteHit('POST /admin/store/products', event);

  try {
    const payload = parseJsonBody(event);
    const result = await createStoreProduct(event, payload);
    return jsonResponse(201, result, correlationId);
  } catch (error) {
    logger.error('POST /admin/store/products failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : 'UnknownError',
      stack: error instanceof Error ? error.stack : undefined
    });
    return mapApiError(error, correlationId);
  }
});

app.post('/admin/store/product-images', async ({ event }) => {
  const correlationId = getCorrelationId(event);
  logRouteHit('POST /admin/store/product-images', event);

  try {
    const payload = parseJsonBody(event);
    const result = await createStoreProductImageUploadIntent(event, payload);
    return jsonResponse(201, result, correlationId);
  } catch (error) {
    logger.error('POST /admin/store/product-images failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : 'UnknownError',
      stack: error instanceof Error ? error.stack : undefined
    });
    return mapApiError(error, correlationId);
  }
});

app.notFound(({ event }) => {
  const correlationId = getCorrelationId(event);
  logger.warn('Route not matched', {
    correlationId,
    method: event?.requestContext?.http?.method ?? event?.httpMethod,
    path: event?.rawPath ?? event?.path
  });
  return errorResponse(404, 'Not Found', correlationId);
});

function matchStoreProductUpdatePath(path) {
  const match = path.match(/^\/admin\/store\/products\/([^/]+)$/);
  return match?.[1] ?? null;
}

function matchStoreProductImageCompletePath(path) {
  const match = path.match(/^\/admin\/store\/product-images\/([^/]+)\/complete$/);
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

  // Bootstrap log: plain console.log so a powertools Logger init failure
  // can't hide the fact that the handler ran.
  console.log(JSON.stringify({
    level: 'INFO',
    msg: 'admin-api handler entry',
    correlationId,
    method,
    rawPath,
    normalizedPath
  }));

  logger.info('Request received', {
    correlationId,
    method,
    rawPath,
    normalizedPath,
    hasBody: Boolean(event?.body),
    authorizerPresent: Boolean(event?.requestContext?.authorizer),
    authorizerKeys: event?.requestContext?.authorizer ? Object.keys(event.requestContext.authorizer) : []
  });

  if (method === 'OPTIONS') {
    return jsonResponse(200, {}, correlationId);
  }

  try {
    const imageId =
      method === 'POST' ? matchStoreProductImageCompletePath(normalizedPath) : null;

    if (imageId) {
      logRouteHit(`POST /admin/store/product-images/${imageId}/complete`, normalizedEvent);
      const result = await completeStoreProductImageUpload(normalizedEvent, imageId);
      const response = jsonResponse(200, result, correlationId);
      logger.info('Response sent', {
        correlationId,
        method,
        path: normalizedPath,
        status: response.statusCode
      });
      return response;
    }

    const productId =
      method === 'PUT' ? matchStoreProductUpdatePath(normalizedPath) : null;

    if (productId) {
      logRouteHit(`PUT /admin/store/products/${productId}`, normalizedEvent);
      const result = await updateStoreProduct(
        normalizedEvent,
        parseJsonBody(normalizedEvent),
        productId
      );
      const response = jsonResponse(200, result, correlationId);
      logger.info('Response sent', {
        correlationId,
        method,
        path: normalizedPath,
        status: response.statusCode
      });
      return response;
    }

    const archiveProductId =
      method === 'DELETE' ? matchStoreProductUpdatePath(normalizedPath) : null;

    if (archiveProductId) {
      logRouteHit(`DELETE /admin/store/products/${archiveProductId}`, normalizedEvent);
      const result = await archiveStoreProduct(normalizedEvent, archiveProductId);
      const response = jsonResponse(200, result, correlationId);
      logger.info('Response sent', {
        correlationId,
        method,
        path: normalizedPath,
        status: response.statusCode
      });
      return response;
    }

    const response = await app.resolve(normalizedEvent, context);

    logger.info('Response sent', {
      correlationId,
      method,
      path: normalizedPath,
      status: response?.statusCode ?? 'unknown',
      responseShape: response
        ? {
            hasStatusCode: 'statusCode' in response,
            hasBody: 'body' in response,
            bodyType: typeof response.body,
            headerKeys: response.headers ? Object.keys(response.headers) : []
          }
        : null
    });

    return response;
  } catch (error) {
    logger.error('Request handler returned error', {
      correlationId,
      method,
      path: normalizedPath,
      error: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : 'UnknownError',
      stack: error instanceof Error ? error.stack : undefined
    });

    return mapApiError(error, correlationId);
  }
}
