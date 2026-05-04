import { createDbClient } from '../../scripts/db-client.mjs';
import { resolveOptionalAuthContext } from './auth.mjs';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const PUBLIC_STATUSES = ['coming_soon', 'gauging_interest', 'open', 'closed', 'past'];

// How long a pending paid-signup row holds capacity before the cap-check
// query starts ignoring it. Stripe Checkout sessions default to 24h but
// we'd rather free seats sooner — 30 minutes is enough to complete a
// reasonable checkout, and matches the Stripe Checkout session expiry we
// set when creating the session.
const PENDING_PAYMENT_TTL_SECONDS = 30 * 60;

const WORKSHOP_SELECT_COLUMNS = `
  id::text as id, slug, title, short_description, description,
  status::text as status, workshop_date, location, capacity,
  image_s3_key, is_paid, price_cents, currency, stripe_price_id,
  created_at, updated_at
`;

function buildCdnUrl(s3Key) {
  if (!s3Key) return null;
  const cdnDomain = process.env.MEDIA_CDN_DOMAIN;
  if (!cdnDomain) return null;
  return `https://${cdnDomain}/${s3Key}`;
}

async function withClient(work) {
  const client = await createDbClient();
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
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

function mapPublicWorkshop(row, signupCounts, mySignup) {
  const counts = signupCounts ?? { registered: 0, waitlisted: 0, interested: 0 };
  const capacity = row.capacity ?? null;
  const seatsRemaining =
    capacity === null ? null : Math.max(0, capacity - counts.registered);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    short_description: row.short_description,
    description: row.description,
    status: row.status,
    workshop_date: row.workshop_date?.toISOString?.() ?? row.workshop_date,
    location: row.location,
    capacity,
    seats_remaining: seatsRemaining,
    image_url: buildCdnUrl(row.image_s3_key),
    is_paid: row.is_paid ?? false,
    price_cents: row.price_cents ?? null,
    currency: row.currency ?? 'usd',
    interested_count: counts.interested,
    my_signup: mySignup ?? null
  };
}

// Counts rows that occupy a "registered seat" — successful paid signups,
// free signups, and not-yet-expired pending paid signups (capacity has to
// be reserved during checkout or two users could both try to grab the
// last seat). Once the pending row's expires_at passes, the seat is freed
// here even if the row stays in the table.
async function loadSignupCountsByWorkshop(client, workshopIds) {
  if (workshopIds.length === 0) return new Map();
  const result = await client.query(
    `
      select
        workshop_id::text as workshop_id,
        kind::text as kind,
        count(*) filter (
          where payment_status in ('not_required', 'paid')
             or (payment_status = 'pending' and expires_at > now())
        )::int as effective_count,
        count(*)::int as total_count
        from workshop_signups
       where workshop_id = any($1::uuid[])
         and cancelled_at is null
       group by workshop_id, kind
    `,
    [workshopIds]
  );
  const byWorkshop = new Map();
  for (const row of result.rows) {
    const counts = byWorkshop.get(row.workshop_id) ?? { registered: 0, waitlisted: 0, interested: 0 };
    // For 'registered' (which is the only kind paid-checkout uses) we want
    // the effective count — i.e. expired pending rows don't hold seats.
    // For waitlist/interested kinds the two counts are equal.
    counts[row.kind] = row.kind === 'registered' ? row.effective_count : row.total_count;
    byWorkshop.set(row.workshop_id, counts);
  }
  return byWorkshop;
}

async function loadMySignups(client, workshopIds, userId) {
  if (!userId || workshopIds.length === 0) return new Map();
  const result = await client.query(
    `
      select workshop_id::text as workshop_id,
             kind::text as kind,
             payment_status::text as payment_status,
             stripe_checkout_session_id,
             stripe_checkout_url,
             expires_at,
             paid_at,
             created_at
        from workshop_signups
       where user_id = $1::uuid
         and workshop_id = any($2::uuid[])
         and cancelled_at is null
    `,
    [userId, workshopIds]
  );
  const byWorkshop = new Map();
  const nowMs = Date.now();
  for (const row of result.rows) {
    const expiresAtIso = row.expires_at?.toISOString?.() ?? row.expires_at;
    const isExpiredPending =
      row.payment_status === 'pending'
      && expiresAtIso
      && new Date(expiresAtIso).getTime() <= nowMs;
    // checkout_url is meaningful only while the pending session is alive.
    // After expiry we hide it so the UI doesn't offer a dead link; the
    // server's idempotent re-signup path drops the expired row and issues
    // a fresh checkout when the user clicks "register again."
    const checkoutUrl = isExpiredPending ? null : row.stripe_checkout_url;
    byWorkshop.set(row.workshop_id, {
      kind: row.kind,
      payment_status: row.payment_status,
      stripe_checkout_session_id: row.stripe_checkout_session_id,
      checkout_url: checkoutUrl,
      expires_at: expiresAtIso,
      paid_at: row.paid_at?.toISOString?.() ?? row.paid_at,
      created_at: row.created_at?.toISOString?.() ?? row.created_at
    });
  }
  return byWorkshop;
}

export async function listPublicWorkshops(event) {
  const auth = await resolveOptionalAuthContext(event);
  return withClient(async (client) => {
    const result = await client.query(
      `
        select ${WORKSHOP_SELECT_COLUMNS}
          from workshops
         where status <> 'past'
         order by workshop_date asc nulls last, created_at desc
      `
    );
    const ids = result.rows.map((row) => row.id);
    const [counts, mine] = await Promise.all([
      loadSignupCountsByWorkshop(client, ids),
      loadMySignups(client, ids, auth?.userId)
    ]);
    return {
      items: result.rows.map((row) =>
        mapPublicWorkshop(row, counts.get(row.id), mine.get(row.id))
      )
    };
  });
}

export async function getPublicWorkshopBySlug(event, slug) {
  if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) {
    throw new Error('workshop slug must be lowercase kebab-case');
  }
  const auth = await resolveOptionalAuthContext(event);
  return withClient(async (client) => {
    const result = await client.query(
      `select ${WORKSHOP_SELECT_COLUMNS} from workshops where slug = $1`,
      [slug]
    );
    if (result.rows.length === 0) {
      throw new Error('Workshop not found');
    }
    const row = result.rows[0];
    if (!PUBLIC_STATUSES.includes(row.status)) {
      throw new Error('Workshop not found');
    }
    const [counts, mine] = await Promise.all([
      loadSignupCountsByWorkshop(client, [row.id]),
      loadMySignups(client, [row.id], auth?.userId)
    ]);
    return mapPublicWorkshop(row, counts.get(row.id), mine.get(row.id));
  });
}

function pickSignupKind(workshop, registeredCount) {
  switch (workshop.status) {
    case 'coming_soon':
    case 'past':
      throw new Error('Signups are not open for this workshop');
    case 'gauging_interest':
      return 'interested';
    case 'closed':
      return 'waitlisted';
    case 'open': {
      if (workshop.capacity === null || workshop.capacity === undefined) {
        return 'registered';
      }
      return registeredCount < workshop.capacity ? 'registered' : 'waitlisted';
    }
    default:
      throw new Error('Signups are not open for this workshop');
  }
}

// --- Return URL allowlist (mirrors donations) ---

const defaultAllowedReturnOrigins = [
  'http://localhost:4173',
  'http://localhost:4174',
  'http://127.0.0.1:4173',
  'http://127.0.0.1:4174',
  'https://oliviasgarden.org',
  'https://www.oliviasgarden.org'
];

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

function buildSuccessAndCancelUrls(returnUrl) {
  const success = new URL(returnUrl.toString());
  success.searchParams.set('payment', 'success');
  // Stripe substitutes {CHECKOUT_SESSION_ID} server-side. The client uses
  // it to call retrieveCheckoutSessionStatus if it wants to confirm before
  // the webhook lands.
  success.searchParams.set('session_id', '{CHECKOUT_SESSION_ID}');

  const cancel = new URL(returnUrl.toString());
  cancel.searchParams.set('payment', 'cancelled');
  return { successUrl: success.toString(), cancelUrl: cancel.toString() };
}

// --- Stripe Checkout session for a paid workshop ---

async function createWorkshopCheckoutSession({
  stripeSecretKey,
  stripePriceId,
  successUrl,
  cancelUrl,
  customerEmail,
  workshopId,
  workshopSlug,
  userId,
  expiresAtSeconds
}) {
  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('ui_mode', 'hosted');
  form.set('success_url', successUrl);
  form.set('cancel_url', cancelUrl);
  form.set('line_items[0][price]', stripePriceId);
  form.set('line_items[0][quantity]', '1');
  form.set('expires_at', String(expiresAtSeconds));
  form.set('metadata[workshop_id]', workshopId);
  form.set('metadata[workshop_slug]', workshopSlug);
  form.set('metadata[user_id]', userId);
  // payment_intent_data.metadata duplicates the same fields onto the
  // PaymentIntent so refund/dispute flows in the dashboard show context
  // even if you only have the PI in front of you.
  form.set('payment_intent_data[metadata][workshop_id]', workshopId);
  form.set('payment_intent_data[metadata][workshop_slug]', workshopSlug);
  form.set('payment_intent_data[metadata][user_id]', userId);
  if (customerEmail) {
    form.set('customer_email', customerEmail);
  }

  // Idempotency key derived from (workshop, user, expires_at). A retry
  // within the same logical attempt — same expires_at — gets the original
  // session URL back instead of creating a parallel session. A genuinely
  // fresh attempt (after the first session expired) uses a new
  // expires_at, so it's a new key.
  const idempotencyKey = `workshop-checkout:${workshopId}:${userId}:${expiresAtSeconds}`;

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${stripeSecretKey}:`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
      'idempotency-key': idempotencyKey
    },
    body: form
  });

  if (!response.ok) {
    throw new Error(`Stripe workshop checkout creation failed (${response.status}): ${await response.text()}`);
  }
  const body = await response.json();
  if (!body.id || !body.url) {
    throw new Error('Stripe workshop checkout response missing id or url');
  }
  return { id: body.id, url: body.url };
}

function requiredEnvVar(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`${name} is not configured`);
  }
  return value.trim();
}

export async function signUpForWorkshop(event, workshopId) {
  const auth = await resolveOptionalAuthContext(event);
  if (!auth) {
    throw new Error('Authentication required');
  }
  if (!UUID_PATTERN.test(workshopId)) {
    throw new Error('workshop id must be a valid UUID');
  }

  // Body is only required for paid workshops (we need a return URL to
  // bounce the user back to after Stripe Checkout). For free workshops
  // it's optional.
  let payload = {};
  if (event?.body) {
    try {
      payload = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } catch {
      throw new Error('Invalid JSON body');
    }
  }

  return withClient((client) =>
    runInTransaction(client, async () => {
      const workshopRes = await client.query(
        `
          select id::text as id, slug, status::text as status, capacity,
                 is_paid, price_cents, currency, stripe_price_id
            from workshops
           where id = $1::uuid
           for update
        `,
        [workshopId]
      );
      if (workshopRes.rows.length === 0) {
        throw new Error('Workshop not found');
      }
      const workshop = workshopRes.rows[0];

      // Up-front existence check, scoped to the active (non-cancelled)
      // row. The partial unique index guarantees there's at most one.
      // Cancelled rows are intentionally invisible here so the user can
      // re-sign-up after a previous cancellation; the audit history stays
      // in the table for admin reconciliation.
      const existing = await client.query(
        `
          select id::text as id,
                 kind::text as kind,
                 payment_status::text as payment_status,
                 stripe_checkout_session_id,
                 stripe_checkout_url,
                 expires_at,
                 created_at
            from workshop_signups
           where workshop_id = $1::uuid
             and user_id = $2::uuid
             and cancelled_at is null
           for update
        `,
        [workshopId, auth.userId]
      );

      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        const isExpiredPending =
          row.payment_status === 'pending'
          && row.expires_at
          && new Date(row.expires_at).getTime() <= Date.now();

        if (!isExpiredPending) {
          // Active signup — return it. For pending paid signups we surface
          // the existing checkout URL so the user can resume rather than
          // start a new session (which would orphan the previous one).
          return {
            already_signed_up: true,
            checkout_required: row.payment_status === 'pending',
            checkout_url: row.stripe_checkout_url ?? null,
            checkout_session_id: row.stripe_checkout_session_id ?? null,
            signup: {
              id: row.id,
              workshop_id: workshopId,
              kind: row.kind,
              payment_status: row.payment_status,
              created_at: row.created_at?.toISOString?.() ?? row.created_at
            }
          };
        }

        // Expired pending row — drop it so we can issue a fresh checkout.
        await client.query(
          `delete from workshop_signups where id = $1::uuid`,
          [row.id]
        );
      }

      const countRes = await client.query(
        `
          select count(*)::int as count
            from workshop_signups
           where workshop_id = $1::uuid
             and kind = 'registered'
             and cancelled_at is null
             and (payment_status in ('not_required', 'paid')
                  or (payment_status = 'pending' and expires_at > now()))
        `,
        [workshopId]
      );
      const registeredCount = countRes.rows[0]?.count ?? 0;
      const kind = pickSignupKind(workshop, registeredCount);

      // Free path: workshop is free, OR user is being placed on waitlist /
      // interest list. Paid workshops still have free waitlist/interest;
      // we only collect payment when the kind would actually be
      // 'registered'.
      const requiresPayment = workshop.is_paid && kind === 'registered';

      if (!requiresPayment) {
        const inserted = await client.query(
          `
            insert into workshop_signups (workshop_id, user_id, kind, payment_status)
            values ($1::uuid, $2::uuid, $3::workshop_signup_kind, 'not_required')
            returning id::text as id, kind::text as kind, created_at, payment_status::text as payment_status
          `,
          [workshopId, auth.userId, kind]
        );
        const row = inserted.rows[0];
        return {
          already_signed_up: false,
          checkout_required: false,
          checkout_url: null,
          checkout_session_id: null,
          signup: {
            id: row.id,
            workshop_id: workshopId,
            kind: row.kind,
            payment_status: row.payment_status,
            created_at: row.created_at?.toISOString?.() ?? row.created_at
          }
        };
      }

      // Paid registered path: create the Stripe Checkout session, then
      // insert a pending row with the session id. If the insert fails
      // after Stripe creates the session we'll have a paid checkout with
      // no DB row — but the webhook handler is idempotent on session id
      // (inserts on conflict do nothing), so the worst case is a customer
      // who paid but isn't recorded; the row will be backfilled by the
      // webhook handler's flow when checkout.session.completed arrives.
      const stripeSecretKey = requiredEnvVar('STRIPE_SECRET_KEY');
      if (!workshop.stripe_price_id) {
        throw new Error('Workshop is marked paid but has no Stripe price configured');
      }
      const returnUrl = parseAndValidateReturnUrl(payload.returnUrl);
      const { successUrl, cancelUrl } = buildSuccessAndCancelUrls(returnUrl);
      const expiresAtSeconds = Math.floor(Date.now() / 1000) + PENDING_PAYMENT_TTL_SECONDS;

      const session = await createWorkshopCheckoutSession({
        stripeSecretKey,
        stripePriceId: workshop.stripe_price_id,
        successUrl,
        cancelUrl,
        customerEmail: auth.email ?? null,
        workshopId,
        workshopSlug: workshop.slug,
        userId: auth.userId,
        expiresAtSeconds
      });

      const inserted = await client.query(
        `
          insert into workshop_signups (
            workshop_id, user_id, kind, payment_status,
            stripe_checkout_session_id, stripe_checkout_url,
            amount_cents, currency, expires_at
          ) values (
            $1::uuid, $2::uuid, $3::workshop_signup_kind, 'pending',
            $4, $5, $6, $7, to_timestamp($8)
          )
          returning id::text as id, kind::text as kind, payment_status::text as payment_status, created_at
        `,
        [
          workshopId,
          auth.userId,
          kind,
          session.id,
          session.url,
          workshop.price_cents,
          workshop.currency,
          expiresAtSeconds
        ]
      );
      const row = inserted.rows[0];
      return {
        already_signed_up: false,
        checkout_required: true,
        checkout_url: session.url,
        checkout_session_id: session.id,
        signup: {
          id: row.id,
          workshop_id: workshopId,
          kind: row.kind,
          payment_status: row.payment_status,
          created_at: row.created_at?.toISOString?.() ?? row.created_at
        }
      };
    })
  );
}

export async function cancelMyWorkshopSignup(event, workshopId) {
  const auth = await resolveOptionalAuthContext(event);
  if (!auth) {
    throw new Error('Authentication required');
  }
  if (!UUID_PATTERN.test(workshopId)) {
    throw new Error('workshop id must be a valid UUID');
  }

  return withClient((client) =>
    runInTransaction(client, async () => {
      // Look up the active row first so we know which branch to take.
      // Free + pending paid signups can hard-delete (no money exchanged
      // → no audit trail needed). Paid signups soft-cancel so the admin
      // can see "user X paid Y on Z and cancelled — issue refund" rather
      // than the row vanishing.
      const lookup = await client.query(
        `
          select id::text as id, payment_status::text as payment_status
            from workshop_signups
           where workshop_id = $1::uuid
             and user_id = $2::uuid
             and cancelled_at is null
           for update
        `,
        [workshopId, auth.userId]
      );
      if (lookup.rows.length === 0) {
        throw new Error('Workshop signup not found');
      }
      const row = lookup.rows[0];

      if (row.payment_status === 'paid') {
        await client.query(
          `update workshop_signups set cancelled_at = now() where id = $1::uuid`,
          [row.id]
        );
        return {
          canceled: true,
          workshop_id: workshopId,
          requires_admin_refund: true
        };
      }

      await client.query(
        `delete from workshop_signups where id = $1::uuid`,
        [row.id]
      );
      return {
        canceled: true,
        workshop_id: workshopId,
        requires_admin_refund: false
      };
    })
  );
}

export async function listMyWorkshopSignups(event) {
  const auth = await resolveOptionalAuthContext(event);
  if (!auth) {
    throw new Error('Authentication required');
  }

  return withClient(async (client) => {
    const result = await client.query(
      `
        select s.id::text as id,
               s.workshop_id::text as workshop_id,
               s.kind::text as kind,
               s.payment_status::text as payment_status,
               s.amount_cents,
               s.currency,
               s.stripe_checkout_url,
               s.expires_at,
               s.paid_at,
               s.created_at,
               w.slug as workshop_slug,
               w.title as workshop_title,
               w.status::text as workshop_status,
               w.workshop_date,
               w.image_s3_key,
               w.location,
               w.is_paid as workshop_is_paid,
               w.price_cents as workshop_price_cents,
               w.currency as workshop_currency
          from workshop_signups s
          join workshops w on w.id = s.workshop_id
         where s.user_id = $1::uuid
           and s.cancelled_at is null
         order by w.workshop_date asc nulls last, s.created_at desc
      `,
      [auth.userId]
    );

    const nowMs = Date.now();
    return {
      items: result.rows.map((row) => {
        const expiresAtIso = row.expires_at?.toISOString?.() ?? row.expires_at;
        const isExpiredPending =
          row.payment_status === 'pending'
          && expiresAtIso
          && new Date(expiresAtIso).getTime() <= nowMs;
        return {
          id: row.id,
          workshop_id: row.workshop_id,
          kind: row.kind,
          payment_status: row.payment_status,
          amount_cents: row.amount_cents,
          currency: row.currency,
          // Same expired-URL handling as loadMySignups: hide a stale URL
          // so the UI doesn't offer a dead link.
          checkout_url: isExpiredPending ? null : row.stripe_checkout_url,
          expires_at: expiresAtIso,
          paid_at: row.paid_at?.toISOString?.() ?? row.paid_at,
          created_at: row.created_at?.toISOString?.() ?? row.created_at,
          workshop: {
            slug: row.workshop_slug,
            title: row.workshop_title,
            status: row.workshop_status,
            workshop_date: row.workshop_date?.toISOString?.() ?? row.workshop_date,
            location: row.location,
            image_url: buildCdnUrl(row.image_s3_key),
            is_paid: row.workshop_is_paid,
            price_cents: row.workshop_price_cents,
            currency: row.workshop_currency
          }
        };
      })
    };
  });
}

// --- Webhook entry: called from stripe-event-consumer when a workshop
// checkout session completes or expires. Idempotent on session id so a
// retried webhook is safe.

export async function persistWorkshopCheckoutCompletion(client, eventId, object, correlationId) {
  const sessionId = object.id ?? null;
  if (!sessionId) return;

  const paymentIntentId = object.payment_intent ?? null;
  const amountTotal = Number(object.amount_total ?? 0) || null;
  const currency = object.currency ?? null;
  const paymentStatus = object.payment_status ?? null;

  // Stripe sends checkout.session.completed even for unpaid sessions when
  // the customer is in async payment mode. Only flip our row to 'paid' if
  // Stripe says the payment actually went through.
  if (paymentStatus !== 'paid') {
    console.info(JSON.stringify({
      level: 'info',
      correlationId,
      eventId,
      sessionId,
      paymentStatus,
      message: 'Workshop checkout completed but not yet paid; ignoring'
    }));
    return;
  }

  const result = await client.query(
    `
      update workshop_signups
         set payment_status = 'paid',
             stripe_payment_intent_id = $2,
             amount_cents = coalesce($3, amount_cents),
             currency = coalesce($4, currency),
             paid_at = now(),
             expires_at = null
       where stripe_checkout_session_id = $1
         and payment_status = 'pending'
       returning id::text as id, workshop_id::text as workshop_id, user_id::text as user_id
    `,
    [sessionId, paymentIntentId, amountTotal, currency]
  );

  if (result.rowCount === 0) {
    // No pending row matched. This is the normal case for a retried
    // webhook (already moved to 'paid') OR for a checkout where the local
    // pending insert failed earlier. We don't backfill here — admin can
    // reconcile from Stripe metadata if needed.
    console.info(JSON.stringify({
      level: 'info',
      correlationId,
      eventId,
      sessionId,
      message: 'No pending workshop signup matched the completed checkout session (already paid or never inserted)'
    }));
    return;
  }

  console.info(JSON.stringify({
    level: 'info',
    correlationId,
    eventId,
    sessionId,
    signupId: result.rows[0].id,
    message: 'Workshop signup marked paid'
  }));
}

export async function persistWorkshopCheckoutExpiry(client, eventId, object, correlationId) {
  const sessionId = object.id ?? null;
  if (!sessionId) return;

  // Drop the pending row so the seat goes back to the pool. (The capacity
  // query already excludes expired pending rows, but deleting keeps the
  // table tidy and surfaces a clean slate if the user retries.)
  const result = await client.query(
    `
      delete from workshop_signups
       where stripe_checkout_session_id = $1
         and payment_status = 'pending'
       returning id::text as id
    `,
    [sessionId]
  );

  if (result.rowCount > 0) {
    console.info(JSON.stringify({
      level: 'info',
      correlationId,
      eventId,
      sessionId,
      signupId: result.rows[0].id,
      message: 'Workshop signup released after Stripe checkout expired'
    }));
  }
}

// Stripe sends `charge.refunded` whenever a refund is created against a
// charge — both partial and full. We treat any refund as terminal for the
// workshop signup: flip payment_status to 'refunded' so admin lists no
// longer surface the row as actively paid. Idempotent on
// (stripe_payment_intent_id, payment_status='paid'), so a retried event
// or a second partial refund is a no-op the second time.
export async function persistWorkshopRefund(client, eventId, object, correlationId) {
  const paymentIntentId = object.payment_intent ?? null;
  if (!paymentIntentId) return;

  const result = await client.query(
    `
      update workshop_signups
         set payment_status = 'refunded'
       where stripe_payment_intent_id = $1
         and payment_status = 'paid'
       returning id::text as id, workshop_id::text as workshop_id, user_id::text as user_id, cancelled_at
    `,
    [paymentIntentId]
  );

  if (result.rowCount === 0) {
    console.info(JSON.stringify({
      level: 'info',
      correlationId,
      eventId,
      paymentIntentId,
      message: 'No paid workshop signup matched the refunded charge (already refunded or never recorded)'
    }));
    return;
  }

  console.info(JSON.stringify({
    level: 'info',
    correlationId,
    eventId,
    paymentIntentId,
    signupId: result.rows[0].id,
    wasCancelledFirst: result.rows[0].cancelled_at !== null,
    message: 'Workshop signup marked refunded'
  }));
}
