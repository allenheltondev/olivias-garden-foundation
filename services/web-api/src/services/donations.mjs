import { createDbClient } from '../../scripts/db-client.mjs';
import { resolveOptionalAuthContext } from './auth.mjs';

export const donationCheckoutSessionSchema = {
  type: 'object',
  required: ['mode', 'amountCents', 'returnUrl'],
  additionalProperties: false,
  properties: {
    mode: {
      type: 'string',
      enum: ['one_time', 'recurring']
    },
    amountCents: {
      type: 'integer',
      minimum: 500
    },
    returnUrl: {
      type: 'string',
      minLength: 1
    },
    donorName: {
      type: 'string'
    },
    donorEmail: {
      type: 'string'
    },
    dedicationName: {
      type: 'string'
    },
    tShirtPreference: {
      type: 'string'
    }
  }
};

const defaultAllowedReturnOrigins = [
  'http://localhost:4173',
  'http://localhost:4174',
  'http://127.0.0.1:4173',
  'http://127.0.0.1:4174',
  'https://oliviasgarden.org',
  'https://www.oliviasgarden.org'
];

function requiredEnvVar(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`${name} is not configured`);
  }

  return value.trim();
}

function normalizeMode(mode) {
  if (mode === 'one_time' || mode === 'recurring') {
    return mode;
  }

  throw new Error('mode must be one of: one_time, recurring');
}

function parseOptionalUuid(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  return value.trim();
}

function readMetadata(metadata, key) {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function extractMode(metadata) {
  return readMetadata(metadata, 'donation_mode') ?? 'one_time';
}

function getAllowedReturnOrigins() {
  const configuredOrigins = (process.env.ALLOWED_RETURN_URL_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return new Set([...defaultAllowedReturnOrigins, ...configuredOrigins]);
}

function parseAndValidateReturnUrl(returnUrl) {
  if (typeof returnUrl !== 'string' || !returnUrl.trim()) {
    throw new Error('returnUrl is required');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(returnUrl);
  } catch {
    throw new Error('returnUrl must be a valid absolute URL');
  }

  if (!getAllowedReturnOrigins().has(parsedUrl.origin)) {
    throw new Error('returnUrl origin is not allowed');
  }

  return parsedUrl;
}

function donationSlackText(mode, amountCents, currency, donorName, donorEmail, dedicationName, tShirtPreference) {
  const amount = `${String(currency ?? 'usd').toUpperCase()} ${(amountCents / 100).toFixed(2)}`;
  const lines = [
    ':sunflower: New donation',
    `Mode: ${mode === 'recurring' ? 'Garden Club' : 'One-time'}`,
    `Amount: ${amount}`
  ];

  if (donorName) {
    lines.push(`Donor: ${donorName}`);
  }
  if (donorEmail) {
    lines.push(`Email: ${donorEmail}`);
  }
  if (dedicationName) {
    lines.push(`Bee nameplate: ${dedicationName}`);
  }
  if (tShirtPreference) {
    lines.push(`T-shirt choice: ${tShirtPreference}`);
  }

  lines.push('Gift includes a permanent acrylic bee placed in the garden.');
  return lines.join('\n');
}

async function notifySlack(text, correlationId) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl?.trim()) {
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
        message: 'Donation Slack webhook returned non-success'
      }));
      return;
    }

    console.info(JSON.stringify({
      level: 'info',
      correlationId,
      message: 'Delivered donation Slack notification'
    }));
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      correlationId,
      message: 'Donation Slack webhook request failed',
      error: error instanceof Error ? error.message : String(error)
    }));
  }
}

function validateCheckoutPayload(payload) {
  normalizeMode(payload?.mode);

  if (!Number.isFinite(payload?.amountCents) || payload.amountCents < 500) {
    throw new Error('amountCents must be at least 500');
  }

  parseAndValidateReturnUrl(payload?.returnUrl);
}

function buildCheckoutDescription(mode, dedicationName) {
  const baseDescription = mode === 'recurring'
    ? 'Monthly Garden Club membership with a permanent bee in the garden and a free t-shirt.'
    : 'One-time gift with a permanent acrylic bee placed in the garden.';

  if (!dedicationName) {
    return baseDescription;
  }

  return `${baseDescription} Bee dedication: ${dedicationName}.`;
}

async function createStripeCustomer(stripeSecretKey, donorName, donorEmail, dedicationName, authContext, correlationId) {
  if (!donorEmail) {
    return null;
  }

  const params = new URLSearchParams();
  params.set('email', donorEmail);

  if (donorName) {
    params.set('name', donorName);
  }
  if (dedicationName) {
    params.set('metadata[dedication_name]', dedicationName);
  }
  if (authContext?.userId) {
    params.set('metadata[user_id]', authContext.userId);
  }

  try {
    const response = await fetch('https://api.stripe.com/v1/customers', {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${stripeSecretKey}:`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: params
    });

    if (!response.ok) {
      console.warn(JSON.stringify({
        level: 'warn',
        correlationId,
        status: response.status,
        message: 'Stripe customer prefill creation failed'
      }));
      return null;
    }

    const payload = await response.json();
    return typeof payload.id === 'string' && payload.id ? payload.id : null;
  } catch (error) {
    console.warn(JSON.stringify({
      level: 'warn',
      correlationId,
      message: 'Stripe customer prefill request failed',
      error: error instanceof Error ? error.message : String(error)
    }));
    return null;
  }
}

function buildCheckoutForm(payload, authContext, customerId = null) {
  const mode = normalizeMode(payload.mode);
  const returnUrl = parseAndValidateReturnUrl(payload.returnUrl);
  const donorName = payload.donorName?.trim() || authContext?.name || undefined;
  const donorEmail = payload.donorEmail?.trim() || authContext?.email || undefined;
  const dedicationName = payload.dedicationName?.trim() || undefined;
  const tShirtPreference = payload.tShirtPreference?.trim() || undefined;

  const params = new URLSearchParams();
  params.set('ui_mode', 'embedded_page');
  params.set('mode', mode === 'recurring' ? 'subscription' : 'payment');
  params.set('return_url', returnUrl.toString());
  params.set('redirect_on_completion', 'always');
  params.set('billing_address_collection', 'auto');
  params.set('submit_type', 'donate');
  params.set('line_items[0][quantity]', '1');
  params.set('line_items[0][price_data][currency]', 'usd');
  params.set(
    'line_items[0][price_data][product_data][name]',
    mode === 'recurring' ? "Olivia's Garden Garden Club" : "Olivia's Garden Donation"
  );
  params.set(
    'line_items[0][price_data][product_data][description]',
    buildCheckoutDescription(mode, dedicationName)
  );
  params.set('line_items[0][price_data][unit_amount]', String(payload.amountCents));
  params.set('metadata[donation_mode]', mode);

  if (mode === 'recurring') {
    params.set('line_items[0][price_data][recurring][interval]', 'month');
  } else {
    params.set('customer_creation', 'always');
  }
  if (authContext?.userId) {
    params.set('metadata[user_id]', authContext.userId);
  }
  if (customerId) {
    params.set('customer', customerId);
  }
  if (donorName) {
    params.set('metadata[donor_name]', donorName);
  }
  if (!customerId && donorEmail) {
    params.set('customer_email', donorEmail);
  }
  if (donorEmail) {
    params.set('metadata[donor_email]', donorEmail);
  }
  if (dedicationName) {
    params.set('metadata[dedication_name]', dedicationName);
  }
  if (tShirtPreference) {
    params.set('metadata[t_shirt_preference]', tShirtPreference);
  }

  return params;
}

async function applyUserDonationSummary(client, userId, amountCents, mode, customerId, subscriptionId, tShirtPreference) {
  const gardenClubStatus = mode === 'recurring' ? 'active' : null;

  await client.query(
    `
      update users
         set donation_total_cents = donation_total_cents + $2,
             donation_count = donation_count + 1,
             last_donated_at = now(),
             last_donation_mode = $3,
             stripe_donor_customer_id = coalesce($4, stripe_donor_customer_id),
             stripe_garden_club_subscription_id = coalesce($5, stripe_garden_club_subscription_id),
             garden_club_status = coalesce($6, garden_club_status),
             garden_club_t_shirt_preference = coalesce($7, garden_club_t_shirt_preference),
             updated_at = now()
       where id = $1
         and deleted_at is null
    `,
    [userId, amountCents, mode, customerId, subscriptionId, gardenClubStatus, tShirtPreference]
  );
}

async function runInTransaction(client, work) {
  await client.query('BEGIN');

  try {
    const result = await work();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function findDonationIdentity(client, subscriptionId, customerId) {
  if (!subscriptionId && !customerId) {
    return null;
  }

  const result = await client.query(
    `
      select donor_name, donor_email, dedication_name, t_shirt_preference
        from donation_events
       where ($1::text is not null and stripe_subscription_id = $1)
          or ($2::text is not null and stripe_customer_id = $2)
       order by created_at desc
       limit 1
    `,
    [subscriptionId, customerId]
  );

  return result.rows[0] ?? null;
}

async function persistCheckoutCompletion(client, eventId, object, correlationId) {
  const metadata = object.metadata ?? null;
  const mode = extractMode(metadata);
  const amountCents = Number(object.amount_total ?? 0);
  const currency = object.currency ?? 'usd';
  const donorName = readMetadata(metadata, 'donor_name');
  const donorEmail = readMetadata(metadata, 'donor_email');
  const dedicationName = readMetadata(metadata, 'dedication_name');
  const tShirtPreference = readMetadata(metadata, 't_shirt_preference');
  const userId = parseOptionalUuid(readMetadata(metadata, 'user_id'));
  const checkoutSessionId = object.id ?? null;
  const paymentIntentId = object.payment_intent ?? null;
  const customerId = object.customer ?? null;
  const subscriptionId = object.subscription ?? null;

  const inserted = await runInTransaction(client, async () => {
    const insertResult = await client.query(
      `
        insert into donation_events (
          stripe_event_id, stripe_checkout_session_id, stripe_payment_intent_id,
          stripe_customer_id, stripe_subscription_id, user_id, donation_mode, amount_cents,
          currency, donor_name, donor_email, dedication_name, t_shirt_preference
        )
        values ($1, $2, $3, $4, $5, $6::uuid, $7, $8, $9, $10, $11, $12, $13)
        on conflict (stripe_event_id) do nothing
      `,
      [
        eventId,
        checkoutSessionId,
        paymentIntentId,
        customerId,
        subscriptionId,
        userId,
        mode,
        amountCents,
        currency,
        donorName,
        donorEmail,
        dedicationName,
        tShirtPreference
      ]
    );

    if (insertResult.rowCount === 0) {
      return false;
    }

    if (userId) {
      await applyUserDonationSummary(
        client,
        userId,
        amountCents,
        mode,
        customerId,
        subscriptionId,
        tShirtPreference
      );
    }

    return true;
  });

  if (!inserted) {
    return;
  }

  await notifySlack(
    donationSlackText(mode, amountCents, currency, donorName, donorEmail, dedicationName, tShirtPreference),
    correlationId
  );
}

async function persistInvoicePaid(client, eventId, object, correlationId) {
  if (object.billing_reason === 'subscription_create') {
    return;
  }

  const subscriptionId = object.subscription ?? null;
  if (!subscriptionId) {
    return;
  }

  const invoiceId = object.id ?? null;
  const customerId = object.customer ?? null;
  const amountCents = Number(object.amount_paid ?? 0);
  const currency = object.currency ?? 'usd';
  const priorIdentity = await findDonationIdentity(client, subscriptionId, customerId);

  const userResult = await client.query(
    `
      select id, email::text as email, garden_club_t_shirt_preference
        from users
       where stripe_garden_club_subscription_id = $1
         and deleted_at is null
    `,
    [subscriptionId]
  );

  const user = userResult.rows[0] ?? null;
  const donorName = priorIdentity?.donor_name ?? null;
  const donorEmail = object.customer_email ?? user?.email ?? priorIdentity?.donor_email ?? null;
  const dedicationName = priorIdentity?.dedication_name ?? null;
  const tShirtPreference = user?.garden_club_t_shirt_preference ?? priorIdentity?.t_shirt_preference ?? null;

  const inserted = await runInTransaction(client, async () => {
    const insertResult = await client.query(
      `
        insert into donation_events (
          stripe_event_id, stripe_invoice_id, stripe_customer_id, stripe_subscription_id,
          user_id, donation_mode, amount_cents, currency, donor_name, donor_email,
          dedication_name, t_shirt_preference
        )
        values ($1, $2, $3, $4, $5::uuid, 'recurring', $6, $7, $8, $9, $10, $11)
        on conflict (stripe_invoice_id) do nothing
      `,
      [
        eventId,
        invoiceId,
        customerId,
        subscriptionId,
        user?.id ?? null,
        amountCents,
        currency,
        donorName,
        donorEmail,
        dedicationName,
        tShirtPreference
      ]
    );

    if (insertResult.rowCount === 0) {
      return false;
    }

    if (user?.id) {
      await applyUserDonationSummary(
        client,
        user.id,
        amountCents,
        'recurring',
        customerId,
        subscriptionId,
        tShirtPreference
      );
    }

    return true;
  });

  if (!inserted) {
    return;
  }

  await notifySlack(
    donationSlackText('recurring', amountCents, currency, donorName, donorEmail, dedicationName, tShirtPreference),
    correlationId
  );
}

async function markGardenClubStatus(client, subscriptionId, nextStatus) {
  if (!subscriptionId) {
    return;
  }

  await client.query(
    `
      update users
         set garden_club_status = $2,
             updated_at = now()
       where stripe_garden_club_subscription_id = $1
         and deleted_at is null
    `,
    [subscriptionId, nextStatus]
  );
}

async function persistInvoicePaymentFailed(client, object, correlationId) {
  const subscriptionId = object.subscription ?? null;
  if (!subscriptionId) {
    return;
  }

  await markGardenClubStatus(client, subscriptionId, 'past_due');

  console.info(JSON.stringify({
    level: 'info',
    correlationId,
    subscriptionId,
    message: 'Marked Garden Club subscription as past_due after invoice.payment_failed'
  }));
}

async function persistSubscriptionDeleted(client, object, correlationId) {
  const subscriptionId = object.id ?? null;
  if (!subscriptionId) {
    return;
  }

  await markGardenClubStatus(client, subscriptionId, 'canceled');

  console.info(JSON.stringify({
    level: 'info',
    correlationId,
    subscriptionId,
    message: 'Marked Garden Club subscription as canceled after customer.subscription.deleted'
  }));
}

async function processStripeEvent(event, correlationId) {
  const stripeEvent = event.detail ?? event;
  const eventId = stripeEvent.id;
  if (!eventId) {
    throw new Error('Stripe event missing id');
  }

  const eventType = stripeEvent.type ?? event['detail-type'] ?? '';
  const object = stripeEvent.data?.object;
  if (!object) {
    throw new Error('Stripe event missing data.object');
  }

  const client = await createDbClient();
  await client.connect();

  try {
    if (eventType === 'checkout.session.completed') {
      await persistCheckoutCompletion(client, eventId, object, correlationId);
      return;
    }

    if (eventType === 'invoice.paid') {
      await persistInvoicePaid(client, eventId, object, correlationId);
      return;
    }

    if (eventType === 'invoice.payment_failed') {
      await persistInvoicePaymentFailed(client, object, correlationId);
      return;
    }

    if (eventType === 'customer.subscription.deleted') {
      await persistSubscriptionDeleted(client, object, correlationId);
      return;
    }

    console.info(JSON.stringify({
      level: 'info',
      correlationId,
      eventType,
      message: 'Ignoring unsupported Stripe EventBridge event'
    }));
  } finally {
    await client.end();
  }
}

export async function createDonationCheckoutSession(payload, event, correlationId) {
  const authContext = await resolveOptionalAuthContext(event);
  validateCheckoutPayload(payload);

  const stripeSecretKey = requiredEnvVar('STRIPE_SECRET_KEY');
  const customerId = await createStripeCustomer(
    stripeSecretKey,
    payload.donorName?.trim() || authContext?.name || undefined,
    payload.donorEmail?.trim() || authContext?.email || undefined,
    payload.dedicationName?.trim() || undefined,
    authContext,
    correlationId
  );
  const form = buildCheckoutForm(payload, authContext, customerId);
  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${stripeSecretKey}:`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: form
  });

  if (!response.ok) {
    throw new Error(`Stripe checkout creation failed (${response.status}): ${await response.text()}`);
  }

  const stripePayload = await response.json();
  if (!stripePayload.client_secret) {
    throw new Error('Stripe checkout client secret missing');
  }
  if (!stripePayload.id) {
    throw new Error('Stripe checkout id missing');
  }

  console.info(JSON.stringify({
    level: 'info',
    correlationId,
    checkoutSessionId: stripePayload.id,
    authenticated: Boolean(authContext),
    message: 'Created Stripe donation checkout session'
  }));

  return {
    clientSecret: stripePayload.client_secret,
    checkoutSessionId: stripePayload.id
  };
}

export async function handleEventBridgeEvent(event) {
  const correlationId = event?.id ?? event?.detail?.id ?? crypto.randomUUID();
  await processStripeEvent(event, correlationId);
}

export async function retrieveCheckoutSessionStatus(sessionId) {
  if (typeof sessionId !== 'string' || !sessionId.trim()) {
    throw new Error('sessionId is required');
  }

  const stripeSecretKey = requiredEnvVar('STRIPE_SECRET_KEY');
  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'GET',
    headers: {
      authorization: `Basic ${Buffer.from(`${stripeSecretKey}:`).toString('base64')}`
    }
  });

  if (!response.ok) {
    throw new Error(`Stripe checkout session lookup failed (${response.status}): ${await response.text()}`);
  }

  const stripePayload = await response.json();
  return {
    sessionId: stripePayload.id,
    status: stripePayload.status,
    paymentStatus: stripePayload.payment_status ?? null,
    customerEmail: stripePayload.customer_details?.email ?? stripePayload.customer_email ?? null
  };
}
