import { Logger } from '@aws-lambda-powertools/logger';
import { handleStripeEventBridgeEvent } from '../services/orders.mjs';

const logger = new Logger({ serviceName: 'store-api-stripe-events' });

export async function handler(event) {
  const detailType = event?.['detail-type'] ?? event?.detail?.type ?? 'unknown';
  const eventId = event?.id ?? event?.detail?.id ?? null;

  logger.info('Stripe EventBridge event received', { eventId, detailType });

  try {
    const result = await handleStripeEventBridgeEvent(event);
    logger.info('Stripe event processed', { eventId, detailType, result });
    return result;
  } catch (error) {
    logger.error('Stripe event processing failed', {
      eventId,
      detailType,
      error: error instanceof Error ? error.message : String(error)
    });
    // Re-throw so EventBridge will retry per the function's policy.
    throw error;
  }
}
