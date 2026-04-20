import { Logger } from '@aws-lambda-powertools/logger';
import { handleEventBridgeEvent } from '../services/donations.mjs';

const logger = new Logger({ serviceName: 'web-api-stripe-events' });

export async function handler(event) {
  logger.info('Stripe EventBridge event received', {
    eventId: event?.id,
    detailType: event?.['detail-type'] ?? event?.detail?.type
  });
  await handleEventBridgeEvent(event);
}
