import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { createDbClient } from '../../scripts/db-client.mjs';
import { resolveOptionalAuthContext } from './auth.mjs';
import {
  persistWorkshopCheckoutCompletion,
  persistWorkshopCheckoutExpiry,
  persistWorkshopRefund
} from './workshops.mjs';

const eventBridge = new EventBridgeClient({});

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
    anonymousDonation: {
      type: 'boolean'
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
  return readMetadata(metadata, 'donation_mode');
}

function extractAnonymousDonation(metadata) {
  return readMetadata(metadata, 'anonymous_donation') === 'true';
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

async function publishDonationCompletedEvent(donation, correlationId) {
  try {
    const result = await eventBridge.send(new PutEventsCommand({
      Entries: [
        {
          Source: 'ogf.donations',
          DetailType: 'donation.completed',
          Detail: JSON.stringify({
            mode: donation.mode,
            amountCents: donation.amountCents,
            currency: donation.currency,
            donorName: donation.donorName ?? null,
            donorEmail: donation.donorEmail ?? null,
            dedicationName: donation.dedicationName ?? null,
            tShirtPreference: donation.tShirtPreference ?? null,
            anonymous: Boolean(donation.anonymous),
            stripeCheckoutSessionId: donation.stripeCheckoutSessionId ?? null,
            stripeInvoiceId: donation.stripeInvoiceId ?? null,
            correlationId
          })
        }
      ]
    }));

    if ((result?.FailedEntryCount ?? 0) > 0) {
      console.error(JSON.stringify({
        level: 'error',
        correlationId,
        message: 'Donation EventBridge publish reported failed entries',
        failedEntryCount: result.FailedEntryCount
      }));
    }
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      correlationId,
      message: 'Failed to publish donation completed event',
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

function isAnonymousDonation(payload) {
  return payload?.anonymousDonation === true;
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
  const anonymousDonation = isAnonymousDonation(payload);
  const donorName = anonymousDonation ? undefined : (payload.donorName?.trim() || authContext?.name || undefined);
  const donorEmail = anonymousDonation ? undefined : (payload.donorEmail?.trim() || authContext?.email || undefined);
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
  params.set('metadata[anonymous_donation]', anonymousDonation ? 'true' : 'false');

  if (mode === 'recurring') {
    params.set('line_items[0][price_data][recurring][interval]', 'month');
  } else if (!customerId) {
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

  // Donations and the store share the same Stripe partner event bus, so this
  // consumer also sees non-donation checkouts. Donation flows always set
  // metadata.donation_mode; absence of that marker means the event belongs to
  // a different consumer (e.g. the store) and we must not record it as a
  // donation.
  if (!mode) {
    console.info(JSON.stringify({
      level: 'info',
      correlationId,
      eventId,
      message: 'Skipping checkout.session.completed without donation_mode metadata'
    }));
    return;
  }

  const anonymousDonation = extractAnonymousDonation(metadata);
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
        on conflict (stripe_event_id) where stripe_event_id is not null do nothing
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

  await publishDonationCompletedEvent(
    {
      mode,
      amountCents,
      currency,
      donorName,
      donorEmail,
      dedicationName,
      tShirtPreference,
      anonymous: anonymousDonation,
      stripeCheckoutSessionId: checkoutSessionId
    },
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
        on conflict (stripe_invoice_id) where stripe_invoice_id is not null do nothing
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

  await publishDonationCompletedEvent(
    {
      mode: 'recurring',
      amountCents,
      currency,
      donorName,
      donorEmail,
      dedicationName,
      tShirtPreference,
      anonymous: false,
      stripeInvoiceId: invoiceId
    },
    correlationId
  );
}

async function setGardenClubStatusBySubscription(client, subscriptionId, nextStatus, cancelAt = null) {
  if (!subscriptionId) {
    return null;
  }

  const result = await client.query(
    `
      update users
         set garden_club_status = $2,
             garden_club_cancel_at = $3,
             updated_at = now()
       where stripe_garden_club_subscription_id = $1
         and deleted_at is null
       returning id::text as id, email::text as email, garden_club_cancel_at
    `,
    [subscriptionId, nextStatus, cancelAt]
  );

  return result.rows[0] ?? null;
}

async function persistInvoicePaymentFailed(client, object, correlationId) {
  const subscriptionId = object.subscription ?? null;
  if (!subscriptionId) {
    return;
  }

  await setGardenClubStatusBySubscription(client, subscriptionId, 'past_due');

  console.info(JSON.stringify({
    level: 'info',
    correlationId,
    subscriptionId,
    message: 'Marked Garden Club subscription as past_due after invoice.payment_failed'
  }));
}

function epochSecondsToIsoString(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return new Date(value * 1000).toISOString();
}

async function persistSubscriptionUpdated(client, object, correlationId) {
  const subscriptionId = object.id ?? null;
  if (!subscriptionId) {
    return;
  }

  const cancelAtPeriodEnd = object.cancel_at_period_end === true;
  const stripeStatus = typeof object.status === 'string' ? object.status : null;

  // Stripe sends `customer.subscription.updated` for many reasons: price changes,
  // metadata edits, status transitions, etc. We only react to the cancel-at-
  // period-end toggle and to past_due/active flips. Everything else we ignore so
  // we don't accidentally overwrite local state.
  if (cancelAtPeriodEnd) {
    const cancelAtIso = epochSecondsToIsoString(object.cancel_at)
      ?? epochSecondsToIsoString(object.current_period_end);
    const updated = await setGardenClubStatusBySubscription(client, subscriptionId, 'canceling', cancelAtIso);

    console.info(JSON.stringify({
      level: 'info',
      correlationId,
      subscriptionId,
      cancelAt: cancelAtIso,
      message: 'Marked Garden Club subscription as canceling after customer.subscription.updated'
    }));

    if (updated) {
      await publishGardenClubLifecycleEvent('garden-club.cancellation_scheduled', {
        userId: updated.id,
        donorEmail: updated.email,
        stripeSubscriptionId: subscriptionId,
        cancelAt: cancelAtIso
      }, correlationId);
    }
    return;
  }

  // cancel_at_period_end is false. Either the donor never asked to cancel, or
  // they reversed a pending cancellation. Re-active only when Stripe also says
  // the subscription is active, otherwise leave whatever local status (e.g.
  // past_due) alone.
  if (stripeStatus === 'active') {
    const updated = await setGardenClubStatusBySubscription(client, subscriptionId, 'active', null);
    console.info(JSON.stringify({
      level: 'info',
      correlationId,
      subscriptionId,
      message: 'Reverted Garden Club subscription to active after customer.subscription.updated'
    }));

    if (updated) {
      await publishGardenClubLifecycleEvent('garden-club.cancellation_reverted', {
        userId: updated.id,
        donorEmail: updated.email,
        stripeSubscriptionId: subscriptionId
      }, correlationId);
    }
  }
}

async function persistSubscriptionDeleted(client, object, correlationId) {
  const subscriptionId = object.id ?? null;
  if (!subscriptionId) {
    return;
  }

  const updated = await setGardenClubStatusBySubscription(client, subscriptionId, 'canceled', null);

  console.info(JSON.stringify({
    level: 'info',
    correlationId,
    subscriptionId,
    message: 'Marked Garden Club subscription as canceled after customer.subscription.deleted'
  }));

  if (updated) {
    await publishGardenClubLifecycleEvent('garden-club.canceled', {
      userId: updated.id,
      donorEmail: updated.email,
      stripeSubscriptionId: subscriptionId
    }, correlationId);
  }
}

async function publishGardenClubLifecycleEvent(detailType, detail, correlationId) {
  try {
    const result = await eventBridge.send(new PutEventsCommand({
      Entries: [
        {
          Source: 'ogf.donations',
          DetailType: detailType,
          Detail: JSON.stringify({ ...detail, correlationId })
        }
      ]
    }));

    if ((result?.FailedEntryCount ?? 0) > 0) {
      console.error(JSON.stringify({
        level: 'error',
        correlationId,
        detailType,
        message: 'Garden Club lifecycle event publish reported failed entries',
        failedEntryCount: result.FailedEntryCount
      }));
    }
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      correlationId,
      detailType,
      message: 'Failed to publish Garden Club lifecycle event',
      error: error instanceof Error ? error.message : String(error)
    }));
  }
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
    // Workshops, donations, and the store all share the same Stripe partner
    // event bus. Route by metadata before falling through to the donation
    // path: workshop sessions carry metadata.workshop_id (set in
    // workshops.mjs createWorkshopCheckoutSession), donations carry
    // metadata.donation_mode (set in donations.mjs buildCheckoutForm), and
    // store sessions have neither. Each handler is idempotent.
    const isWorkshopSession =
      typeof object?.metadata?.workshop_id === 'string'
      && object.metadata.workshop_id.length > 0;

    if (isWorkshopSession) {
      if (eventType === 'checkout.session.completed') {
        await persistWorkshopCheckoutCompletion(client, eventId, object, correlationId);
        return;
      }
      if (eventType === 'checkout.session.expired') {
        await persistWorkshopCheckoutExpiry(client, eventId, object, correlationId);
        return;
      }
      if (eventType === 'charge.refunded') {
        // charge.refunded carries metadata on the charge that we mirrored
        // from the PaymentIntent (set via payment_intent_data.metadata at
        // checkout creation). The handler keys off payment_intent_id, not
        // metadata, so the metadata check above is just for routing.
        await persistWorkshopRefund(client, eventId, object, correlationId);
        return;
      }
      // Other event types on a workshop session (e.g. payment_intent.*)
      // aren't actionable for us yet — log and move on.
      console.info(JSON.stringify({
        level: 'info',
        correlationId,
        eventId,
        eventType,
        message: 'Ignoring non-actionable workshop Stripe event'
      }));
      return;
    }

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

    if (eventType === 'customer.subscription.updated') {
      await persistSubscriptionUpdated(client, object, correlationId);
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
  const anonymousDonation = isAnonymousDonation(payload);
  const customerId = await createStripeCustomer(
    stripeSecretKey,
    anonymousDonation ? undefined : (payload.donorName?.trim() || authContext?.name || undefined),
    anonymousDonation ? undefined : (payload.donorEmail?.trim() || authContext?.email || undefined),
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

class GardenClubMembershipNotFoundError extends Error {
  constructor() {
    super('No active Garden Club membership for this account');
    this.code = 'GardenClubMembershipNotFound';
  }
}

class GardenClubAlreadyActiveError extends Error {
  constructor() {
    super('Garden Club membership is already active');
    this.code = 'GardenClubAlreadyActive';
  }
}

async function fetchGardenClubMembership(client, userId) {
  const result = await client.query(
    `
      select id::text as id,
             email::text as email,
             stripe_garden_club_subscription_id,
             garden_club_status,
             garden_club_cancel_at
        from users
       where id = $1::uuid
         and deleted_at is null
    `,
    [userId]
  );

  return result.rows[0] ?? null;
}

async function updateStripeSubscriptionCancelAtPeriodEnd(stripeSecretKey, subscriptionId, cancelAtPeriodEnd) {
  const params = new URLSearchParams();
  params.set('cancel_at_period_end', cancelAtPeriodEnd ? 'true' : 'false');

  const response = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${stripeSecretKey}:`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: params
  });

  if (!response.ok) {
    throw new Error(`Stripe subscription update failed (${response.status}): ${await response.text()}`);
  }

  return response.json();
}

export async function cancelGardenClubSubscription(event, correlationId) {
  const authContext = await resolveOptionalAuthContext(event);
  if (!authContext?.userId) {
    throw new Error('Authorization token is required');
  }

  const stripeSecretKey = requiredEnvVar('STRIPE_SECRET_KEY');
  const client = await createDbClient();
  await client.connect();

  try {
    const membership = await fetchGardenClubMembership(client, authContext.userId);
    if (!membership?.stripe_garden_club_subscription_id) {
      throw new GardenClubMembershipNotFoundError();
    }

    const stripeSubscription = await updateStripeSubscriptionCancelAtPeriodEnd(
      stripeSecretKey,
      membership.stripe_garden_club_subscription_id,
      true
    );

    const cancelAtIso = epochSecondsToIsoString(stripeSubscription.cancel_at)
      ?? epochSecondsToIsoString(stripeSubscription.current_period_end);

    const updated = await setGardenClubStatusBySubscription(
      client,
      membership.stripe_garden_club_subscription_id,
      'canceling',
      cancelAtIso
    );

    console.info(JSON.stringify({
      level: 'info',
      correlationId,
      userId: authContext.userId,
      subscriptionId: membership.stripe_garden_club_subscription_id,
      cancelAt: cancelAtIso,
      message: 'Scheduled Garden Club cancellation at period end'
    }));

    if (updated) {
      await publishGardenClubLifecycleEvent('garden-club.cancellation_scheduled', {
        userId: updated.id,
        donorEmail: updated.email,
        stripeSubscriptionId: membership.stripe_garden_club_subscription_id,
        cancelAt: cancelAtIso
      }, correlationId);
    }

    return {
      gardenClubStatus: 'canceling',
      gardenClubCancelAt: cancelAtIso
    };
  } finally {
    await client.end();
  }
}

export async function resumeGardenClubSubscription(event, correlationId) {
  const authContext = await resolveOptionalAuthContext(event);
  if (!authContext?.userId) {
    throw new Error('Authorization token is required');
  }

  const stripeSecretKey = requiredEnvVar('STRIPE_SECRET_KEY');
  const client = await createDbClient();
  await client.connect();

  try {
    const membership = await fetchGardenClubMembership(client, authContext.userId);
    if (!membership?.stripe_garden_club_subscription_id) {
      throw new GardenClubMembershipNotFoundError();
    }

    if (membership.garden_club_status === 'active') {
      throw new GardenClubAlreadyActiveError();
    }

    if (membership.garden_club_status !== 'canceling') {
      // Only `canceling` is reversible from the donor side. `canceled` means
      // Stripe already deleted the subscription and they would need to start
      // a new Garden Club from the donate page.
      throw new GardenClubMembershipNotFoundError();
    }

    await updateStripeSubscriptionCancelAtPeriodEnd(
      stripeSecretKey,
      membership.stripe_garden_club_subscription_id,
      false
    );

    const updated = await setGardenClubStatusBySubscription(
      client,
      membership.stripe_garden_club_subscription_id,
      'active',
      null
    );

    console.info(JSON.stringify({
      level: 'info',
      correlationId,
      userId: authContext.userId,
      subscriptionId: membership.stripe_garden_club_subscription_id,
      message: 'Reverted scheduled Garden Club cancellation'
    }));

    if (updated) {
      await publishGardenClubLifecycleEvent('garden-club.cancellation_reverted', {
        userId: updated.id,
        donorEmail: updated.email,
        stripeSubscriptionId: membership.stripe_garden_club_subscription_id
      }, correlationId);
    }

    return {
      gardenClubStatus: 'active',
      gardenClubCancelAt: null
    };
  } finally {
    await client.end();
  }
}

export { GardenClubMembershipNotFoundError, GardenClubAlreadyActiveError };
