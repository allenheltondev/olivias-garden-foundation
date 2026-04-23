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

function orgTypeLabel(type) {
  const map = {
    'food-pantry': 'Food pantry',
    shelter: 'Shelter',
    school: 'School or youth program',
    'mutual-aid': 'Mutual aid / community fridge',
    faith: 'Faith community',
    other: 'Other'
  };
  return map[type] ?? (type ? type : 'Unspecified');
}

function buildOrgInquirySlackText(payload) {
  const orgName = sanitize(payload.orgName) || '(no organization name)';
  const lines = [
    ':seedling: New Good Roots org inquiry',
    `Organization: ${orgName} (${orgTypeLabel(payload.orgType)})`,
    `Contact: ${sanitize(payload.contactName)} <${sanitize(payload.email)}>`
  ];

  const phone = sanitize(payload.phone);
  if (phone) lines.push(`Phone: ${phone}`);

  const location = [sanitize(payload.city), sanitize(payload.state)].filter(Boolean).join(', ');
  if (location) lines.push(`Location: ${location}`);

  const message = sanitize(payload.message);
  if (message) lines.push('', message);

  return lines.join('\n');
}

async function postToSlack(webhookUrl, text, correlationId) {
  if (!webhookUrl?.trim()) {
    console.info(JSON.stringify({
      level: 'info',
      correlationId,
      message: 'Contact Slack webhook not configured; skipping notification'
    }));
    return;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text })
    });

    if (!response.ok) {
      console.error(JSON.stringify({
        level: 'error',
        correlationId,
        status: response.status,
        message: 'Contact Slack webhook returned non-success'
      }));
      return;
    }

    console.info(JSON.stringify({
      level: 'info',
      correlationId,
      message: 'Delivered contact Slack notification'
    }));
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      correlationId,
      message: 'Contact Slack webhook request failed',
      error: error instanceof Error ? error.message : String(error)
    }));
  }
}

export async function submitContactInquiry(payload, correlationId, { fetchWebhookUrl = () => process.env.CONTACT_SLACK_WEBHOOK_URL } = {}) {
  if (payload?.kind !== 'organization_inquiry') {
    throw new Error('Unsupported contact kind');
  }

  if (!EMAIL_PATTERN.test(sanitize(payload.email))) {
    throw new Error('email must be a valid email address');
  }

  if (!sanitize(payload.contactName)) {
    throw new Error('contactName is required');
  }

  await postToSlack(fetchWebhookUrl(), buildOrgInquirySlackText(payload), correlationId);
}
