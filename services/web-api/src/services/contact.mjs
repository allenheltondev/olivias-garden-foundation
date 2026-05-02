import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const eventBridge = new EventBridgeClient({});

export const contactInquirySchema = {
  type: 'object',
  required: ['kind', 'contactName', 'email'],
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: ['organization_inquiry', 'general_inquiry'] },
    orgName: { type: 'string', maxLength: 200 },
    contactName: { type: 'string', minLength: 1, maxLength: 200 },
    email: { type: 'string', minLength: 3, maxLength: 320 },
    phone: { type: 'string', maxLength: 40 },
    orgType: { type: 'string', maxLength: 50 },
    city: { type: 'string', maxLength: 120 },
    state: { type: 'string', maxLength: 120 },
    referral: { type: 'string', maxLength: 200 },
    message: { type: 'string', maxLength: 4000 }
  }
};

export const tierInterestSchema = {
  type: 'object',
  required: ['kind', 'email', 'tier'],
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: ['tier_interest'] },
    email: { type: 'string', minLength: 3, maxLength: 320 },
    tier: { type: 'string', enum: ['supporter', 'pro', 'either'] },
    source: { type: 'string', maxLength: 80 }
  }
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sanitize(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function publishOrgInquiryEvent(payload, correlationId, eventBridgeClient) {
  try {
    const result = await eventBridgeClient.send(new PutEventsCommand({
      Entries: [
        {
          Source: 'ogf.contact',
          DetailType: 'org-inquiry.received',
          Detail: JSON.stringify({
            orgName: sanitize(payload.orgName) || null,
            orgType: sanitize(payload.orgType) || null,
            contactName: sanitize(payload.contactName),
            email: sanitize(payload.email),
            phone: sanitize(payload.phone) || null,
            city: sanitize(payload.city) || null,
            state: sanitize(payload.state) || null,
            message: sanitize(payload.message) || null,
            correlationId
          })
        }
      ]
    }));

    if ((result?.FailedEntryCount ?? 0) > 0) {
      console.error(JSON.stringify({
        level: 'error',
        correlationId,
        message: 'Contact EventBridge publish reported failed entries',
        failedEntryCount: result.FailedEntryCount
      }));
    }
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      correlationId,
      message: 'Contact EventBridge publish failed',
      error: error instanceof Error ? error.message : String(error)
    }));
  }
}

async function publishGeneralInquiryEvent(payload, correlationId, eventBridgeClient) {
  try {
    const result = await eventBridgeClient.send(new PutEventsCommand({
      Entries: [
        {
          Source: 'ogf.contact',
          DetailType: 'general-inquiry.received',
          Detail: JSON.stringify({
            contactName: sanitize(payload.contactName),
            email: sanitize(payload.email),
            message: sanitize(payload.message) || null,
            referral: sanitize(payload.referral) || null,
            correlationId
          })
        }
      ]
    }));

    if ((result?.FailedEntryCount ?? 0) > 0) {
      console.error(JSON.stringify({
        level: 'error',
        correlationId,
        message: 'Contact EventBridge publish reported failed entries',
        failedEntryCount: result.FailedEntryCount
      }));
    }
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      correlationId,
      message: 'Contact EventBridge publish failed',
      error: error instanceof Error ? error.message : String(error)
    }));
  }
}

async function publishTierInterestEvent(payload, correlationId, eventBridgeClient) {
  try {
    const result = await eventBridgeClient.send(new PutEventsCommand({
      Entries: [
        {
          Source: 'ogf.contact',
          DetailType: 'tier-interest.received',
          Detail: JSON.stringify({
            email: sanitize(payload.email),
            tier: sanitize(payload.tier),
            source: sanitize(payload.source) || null,
            correlationId
          })
        }
      ]
    }));

    if ((result?.FailedEntryCount ?? 0) > 0) {
      console.error(JSON.stringify({
        level: 'error',
        correlationId,
        message: 'Tier interest EventBridge publish reported failed entries',
        failedEntryCount: result.FailedEntryCount
      }));
    }
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      correlationId,
      message: 'Tier interest EventBridge publish failed',
      error: error instanceof Error ? error.message : String(error)
    }));
  }
}

export async function submitContactInquiry(payload, correlationId, { eventBridgeClient = eventBridge } = {}) {
  if (!['organization_inquiry', 'general_inquiry'].includes(payload?.kind)) {
    throw new Error('Unsupported contact kind');
  }

  if (!EMAIL_PATTERN.test(sanitize(payload.email))) {
    throw new Error('email must be a valid email address');
  }

  if (!sanitize(payload.contactName)) {
    throw new Error('contactName is required');
  }

  if (payload.kind === 'general_inquiry' && !sanitize(payload.message)) {
    throw new Error('message is required');
  }

  if (payload.kind === 'organization_inquiry') {
    await publishOrgInquiryEvent(payload, correlationId, eventBridgeClient);
    return;
  }

  await publishGeneralInquiryEvent(payload, correlationId, eventBridgeClient);
}

export async function submitTierInterestInquiry(payload, correlationId, { eventBridgeClient = eventBridge } = {}) {
  if (payload?.kind !== 'tier_interest') {
    throw new Error('Unsupported contact kind');
  }

  if (!EMAIL_PATTERN.test(sanitize(payload.email))) {
    throw new Error('email must be a valid email address');
  }

  if (!['supporter', 'pro', 'either'].includes(sanitize(payload.tier))) {
    throw new Error('tier must be one of supporter, pro, either');
  }

  await publishTierInterestEvent(payload, correlationId, eventBridgeClient);
}
