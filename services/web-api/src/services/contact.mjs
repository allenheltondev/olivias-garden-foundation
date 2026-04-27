import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const eventBridge = new EventBridgeClient({});

export const contactInquirySchema = {
  type: 'object',
  required: ['kind', 'contactName', 'email'],
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: ['organization_inquiry'] },
    orgName: { type: 'string', maxLength: 200 },
    contactName: { type: 'string', minLength: 1, maxLength: 200 },
    email: { type: 'string', minLength: 3, maxLength: 320 },
    phone: { type: 'string', maxLength: 40 },
    orgType: { type: 'string', maxLength: 50 },
    city: { type: 'string', maxLength: 120 },
    state: { type: 'string', maxLength: 120 },
    message: { type: 'string', maxLength: 4000 }
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

export async function submitContactInquiry(payload, correlationId, { eventBridgeClient = eventBridge } = {}) {
  if (payload?.kind !== 'organization_inquiry') {
    throw new Error('Unsupported contact kind');
  }

  if (!EMAIL_PATTERN.test(sanitize(payload.email))) {
    throw new Error('email must be a valid email address');
  }

  if (!sanitize(payload.contactName)) {
    throw new Error('contactName is required');
  }

  await publishOrgInquiryEvent(payload, correlationId, eventBridgeClient);
}
