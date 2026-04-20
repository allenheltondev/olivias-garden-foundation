import { Router } from '@aws-lambda-powertools/event-handler/http';
import { Logger } from '@aws-lambda-powertools/logger';
import { validate } from '@aws-lambda-powertools/validation';
import { SchemaValidationError } from '@aws-lambda-powertools/validation/errors';
import {
  createDonationCheckoutSession,
  donationCheckoutSessionSchema,
  retrieveCheckoutSessionStatus
} from '../services/donations.mjs';
import {
  corsHeaders,
  errorResponse,
  getCorrelationId,
  jsonResponse,
  mapApiError,
  normalizeRoutePath
} from '../services/http.mjs';

const app = new Router();
const logger = new Logger({ serviceName: 'web-api' });

app.post('/donations/checkout-session', async ({ req, event }) => {
  const correlationId = getCorrelationId(event);
  const payload = await req.json();

  try {
    validate({ payload, schema: donationCheckoutSessionSchema });
  } catch (error) {
    if (error instanceof SchemaValidationError) {
      logger.warn('Donation checkout request validation failed', {
        correlationId,
        issues: error.errors?.map((issue) => issue.message) ?? [error.message]
      });

      return {
        statusCode: 422,
        headers: {
          'x-correlation-id': correlationId
        },
        body: {
          error: 'RequestValidationError',
          message: 'Validation failed for request',
          details: {
            issues: error.errors?.map((issue) => issue.message) ?? [error.message]
          }
        }
      };
    }

    throw error;
  }

  try {
    const checkoutSession = await createDonationCheckoutSession(payload, event, correlationId);
    return {
      statusCode: 200,
      headers: {
        'x-correlation-id': correlationId
      },
      body: checkoutSession
    };
  } catch (error) {
    return mapApiError(error, correlationId);
  }
});

app.get('/donations/checkout-session-status', async ({ event }) => {
  const correlationId = getCorrelationId(event);
  const sessionId = event?.queryStringParameters?.session_id
    ?? event?.queryStringParameters?.sessionId
    ?? '';

  try {
    const session = await retrieveCheckoutSessionStatus(sessionId);
    return {
      statusCode: 200,
      headers: {
        'x-correlation-id': correlationId
      },
      body: session
    };
  } catch (error) {
    return mapApiError(error, correlationId);
  }
});

app.notFound(({ event }) => {
  return errorResponse(404, 'Not Found', getCorrelationId(event));
});

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

  let response;
  try {
    response = await app.resolve(normalizedEvent, context);
  } catch (error) {
    logger.error('Request handler returned error', {
      correlationId,
      method,
      path: normalizedPath,
      error: error instanceof Error ? error.message : String(error)
    });
    return mapApiError(error, correlationId);
  }

  if (response && typeof response === 'object' && !response.headers?.['access-control-allow-origin']) {
    response.headers = {
      ...response.headers,
      ...corsHeaders,
      'x-correlation-id': response.headers?.['x-correlation-id'] ?? correlationId
    };
  }

  logger.info('Response sent', {
    correlationId,
    method,
    path: normalizedPath,
    status: response?.statusCode ?? 200
  });

  return response;
}
