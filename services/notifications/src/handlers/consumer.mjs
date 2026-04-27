import { putActivityEvent } from '../services/event-store.mjs';
import { renderEvent, isContactEvent } from '../services/renderers.mjs';
import { postToSlack } from '../services/slack.mjs';

function resolveCorrelationId(event) {
  return event?.detail?.correlationId ?? event?.id ?? 'unknown';
}

function resolveOccurredAt(event) {
  if (typeof event?.detail?.occurredAt === 'string' && event.detail.occurredAt) {
    return event.detail.occurredAt;
  }
  if (typeof event?.time === 'string' && event.time) {
    return event.time;
  }
  return new Date().toISOString();
}

function resolveSlackWebhook(source) {
  if (isContactEvent(source)) {
    const contact = process.env.CONTACT_SLACK_WEBHOOK_URL?.trim();
    if (contact) return contact;
  }
  return process.env.SLACK_WEBHOOK_URL;
}

export async function handler(event) {
  const source = event?.source;
  const detailType = event?.['detail-type'];
  const detail = event?.detail ?? {};
  const correlationId = resolveCorrelationId(event);
  const eventId = event?.id;

  if (!source || !detailType || !eventId) {
    console.warn(JSON.stringify({
      level: 'warn',
      correlationId,
      message: 'Discarding event missing source/detail-type/id',
      source,
      detailType,
      hasId: Boolean(eventId)
    }));
    return;
  }

  const rendered = renderEvent(source, detailType, detail);
  if (!rendered) {
    console.warn(JSON.stringify({
      level: 'warn',
      correlationId,
      source,
      detailType,
      message: 'No renderer registered for event; skipping'
    }));
    return;
  }

  const occurredAt = resolveOccurredAt(event);

  try {
    await putActivityEvent({
      eventId,
      source,
      detailType,
      occurredAt,
      summary: rendered.summary,
      data: detail
    });
  } catch (error) {
    if (error?.name === 'ConditionalCheckFailedException') {
      console.info(JSON.stringify({
        level: 'info',
        correlationId,
        eventId,
        source,
        detailType,
        message: 'Activity event already persisted; skipping Slack to avoid duplicate'
      }));
      return;
    }
    console.error(JSON.stringify({
      level: 'error',
      correlationId,
      eventId,
      source,
      detailType,
      message: 'Failed to persist activity event',
      error: error instanceof Error ? error.message : String(error)
    }));
    throw error;
  }

  if (rendered.slack) {
    await postToSlack(resolveSlackWebhook(source), rendered.slack, { correlationId, source, detailType });
  }
}
