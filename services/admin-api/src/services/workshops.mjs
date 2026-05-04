import { createHash, randomUUID } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { extractAuthContext, requireAdmin } from './auth.mjs';
import { query } from './db.mjs';

const VALID_STATUSES = ['coming_soon', 'gauging_interest', 'open', 'closed', 'past'];
const VALID_IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const UPLOAD_URL_EXPIRES_SECONDS = 900;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Stripe minimum charge for usd is $0.50. We enforce the same floor at the
// DB layer (workshops_price_cents_range constraint) so an over-clever client
// can't bypass it.
const MIN_PRICE_CENTS = 50;

const WORKSHOP_SELECT_COLUMNS = `
  id::text as id, slug, title, short_description, description,
  status::text as status, workshop_date, location, capacity,
  image_s3_key, is_paid, price_cents, currency,
  stripe_product_id, stripe_price_id,
  created_at, updated_at
`;

function getMediaBucketName() {
  const bucket = process.env.MEDIA_BUCKET_NAME;
  if (!bucket) {
    throw new Error('MEDIA_BUCKET_NAME is not configured');
  }
  return bucket;
}

function getCdnDomain() {
  return process.env.MEDIA_CDN_DOMAIN ?? null;
}

function getAwsRegion() {
  return process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';
}

function buildCdnUrl(s3Key) {
  if (!s3Key) return null;
  const cdnDomain = getCdnDomain();
  if (!cdnDomain) return null;
  return `https://${cdnDomain}/${s3Key}`;
}

function isSlug(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed === value && trimmed.length > 0 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed);
}

function parseWorkshopDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    throw new Error('workshop_date must be an ISO 8601 string');
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('workshop_date must be an ISO 8601 string');
  }
  return date.toISOString();
}

function normalizePaidFields(payload) {
  const isPaid = Boolean(payload.is_paid);
  if (!isPaid) {
    return { is_paid: false, price_cents: null, currency: 'usd' };
  }

  if (!Number.isInteger(payload.price_cents) || payload.price_cents < MIN_PRICE_CENTS) {
    throw new Error(`price_cents must be an integer of at least ${MIN_PRICE_CENTS} when is_paid=true`);
  }
  const currency = typeof payload.currency === 'string' ? payload.currency.toLowerCase().trim() : 'usd';
  if (!/^[a-z]{3}$/.test(currency)) {
    throw new Error('currency must be a 3-letter lowercase ISO code');
  }
  return { is_paid: true, price_cents: payload.price_cents, currency };
}

export function validateWorkshopPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Request body is required');
  }
  if (!isSlug(payload.slug)) {
    throw new Error('slug must be lowercase kebab-case');
  }
  if (typeof payload.title !== 'string' || payload.title.trim().length === 0) {
    throw new Error('title is required');
  }
  if (!VALID_STATUSES.includes(payload.status)) {
    throw new Error(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  }
  if (
    payload.capacity !== null
    && payload.capacity !== undefined
    && (!Number.isInteger(payload.capacity) || payload.capacity < 0)
  ) {
    throw new Error('capacity must be a non-negative integer or null');
  }
  if (payload.short_description !== undefined && payload.short_description !== null && typeof payload.short_description !== 'string') {
    throw new Error('short_description must be a string');
  }
  if (payload.description !== undefined && payload.description !== null && typeof payload.description !== 'string') {
    throw new Error('description must be a string');
  }
  if (payload.location !== undefined && payload.location !== null && typeof payload.location !== 'string') {
    throw new Error('location must be a string');
  }
  if (payload.image_s3_key !== undefined && payload.image_s3_key !== null && typeof payload.image_s3_key !== 'string') {
    throw new Error('image_s3_key must be a string');
  }
}

function mapWorkshopRow(row, signupCounts = null) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    short_description: row.short_description,
    description: row.description,
    status: row.status,
    workshop_date: row.workshop_date?.toISOString?.() ?? row.workshop_date,
    location: row.location,
    capacity: row.capacity,
    image_s3_key: row.image_s3_key,
    image_url: buildCdnUrl(row.image_s3_key),
    is_paid: row.is_paid,
    price_cents: row.price_cents,
    currency: row.currency,
    stripe_product_id: row.stripe_product_id,
    stripe_price_id: row.stripe_price_id,
    signup_counts: signupCounts ?? { registered: 0, waitlisted: 0, interested: 0 },
    created_at: row.created_at?.toISOString?.() ?? row.created_at,
    updated_at: row.updated_at?.toISOString?.() ?? row.updated_at
  };
}

async function loadSignupCountsByWorkshop(workshopIds) {
  if (workshopIds.length === 0) return new Map();
  // Cancelled rows are kept for audit but shouldn't inflate the
  // registered/waitlisted/interested counts on the admin list.
  const result = await query(
    `
      select workshop_id::text as workshop_id, kind::text as kind, count(*)::int as count
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
    counts[row.kind] = row.count;
    byWorkshop.set(row.workshop_id, counts);
  }
  return byWorkshop;
}

export async function listAdminWorkshops(event) {
  const auth = extractAuthContext(event);
  requireAdmin(auth);

  const result = await query(
    `select ${WORKSHOP_SELECT_COLUMNS}
       from workshops
      order by workshop_date asc nulls last, created_at desc`
  );

  const counts = await loadSignupCountsByWorkshop(result.rows.map((row) => row.id));
  return { items: result.rows.map((row) => mapWorkshopRow(row, counts.get(row.id))) };
}

export async function getAdminWorkshop(event, workshopId) {
  const auth = extractAuthContext(event);
  requireAdmin(auth);
  if (!UUID_PATTERN.test(workshopId)) {
    throw new Error('workshop id must be a valid UUID');
  }

  const result = await query(
    `select ${WORKSHOP_SELECT_COLUMNS} from workshops where id = $1::uuid`,
    [workshopId]
  );
  if (result.rows.length === 0) {
    throw new Error('Workshop not found');
  }
  const counts = await loadSignupCountsByWorkshop([workshopId]);
  return mapWorkshopRow(result.rows[0], counts.get(workshopId));
}

// Ensure a row exists in `users` for the admin's userId before we
// reference it via FK from workshops.created_by_user_id /
// updated_by_user_id. Cognito users only get a `users` row the first
// time they touch the web-api profile flow (see profile.mjs#ensureUserRow);
// admins who have only ever signed in to the admin app — including
// the CI test admin — won't have one yet. The web-api side does this
// upsert with full identity (email/name); we don't have those fields
// in the admin auth context, but `users.id` is the only NOT NULL
// column without a default, so a bare-id insert is enough to satisfy
// the FK. The web-api fills in email/name on the first profile read.
async function ensureAdminUserRow(userId) {
  await query(
    `insert into users (id) values ($1::uuid) on conflict (id) do nothing`,
    [userId]
  );
}

export async function createWorkshop(event, payload, options = {}) {
  const auth = extractAuthContext(event);
  requireAdmin(auth);
  validateWorkshopPayload(payload);

  const workshopDate = parseWorkshopDate(payload.workshop_date);
  const { is_paid, price_cents, currency } = normalizePaidFields(payload);

  // Stripe first: create the product + price BEFORE writing the row so we
  // never have a paid workshop in the DB without its Stripe linkage. If
  // Stripe succeeds and the DB insert fails, we leak an orphan product;
  // that's a lesser problem than the DB row pointing at nothing. The
  // store_products service has the same trade-off (see store.mjs).
  let stripeProductId = null;
  let stripePriceId = null;
  if (is_paid) {
    const stripe = options.stripeClient ?? StripeWorkshopClient.fromEnv();
    stripeProductId = await stripe.createProduct({
      slug: payload.slug,
      title: payload.title.trim(),
      description: payload.description ?? payload.short_description ?? null,
      isArchived: payload.status === 'past',
      imageUrl: buildCdnUrl(payload.image_s3_key)
    });
    stripePriceId = await stripe.createPrice(stripeProductId, price_cents, currency);
  }

  try {
    await ensureAdminUserRow(auth.userId);
    const result = await query(
      `
        insert into workshops (
          slug, title, short_description, description, status,
          workshop_date, location, capacity, image_s3_key,
          is_paid, price_cents, currency,
          stripe_product_id, stripe_price_id,
          created_by_user_id, updated_by_user_id
        ) values (
          $1, $2, $3, $4, $5::workshop_status, $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15::uuid, $15::uuid
        )
        returning ${WORKSHOP_SELECT_COLUMNS}
      `,
      [
        payload.slug,
        payload.title.trim(),
        payload.short_description ?? null,
        payload.description ?? null,
        payload.status,
        workshopDate,
        payload.location ?? null,
        payload.capacity ?? null,
        payload.image_s3_key ?? null,
        is_paid,
        price_cents,
        currency,
        stripeProductId,
        stripePriceId,
        auth.userId
      ]
    );

    return mapWorkshopRow(result.rows[0]);
  } catch (error) {
    // Best-effort cleanup: if the DB write failed but the Stripe product
    // was created, archive it so the dashboard isn't full of zombies.
    if (is_paid && stripeProductId) {
      try {
        const stripe = options.stripeClient ?? StripeWorkshopClient.fromEnv();
        await stripe.archiveProduct(stripeProductId);
      } catch {
        // Swallow; surfacing the original error matters more.
      }
    }
    throw error;
  }
}

export async function updateWorkshop(event, payload, workshopId, options = {}) {
  const auth = extractAuthContext(event);
  requireAdmin(auth);
  if (!UUID_PATTERN.test(workshopId)) {
    throw new Error('workshop id must be a valid UUID');
  }
  validateWorkshopPayload(payload);

  const workshopDate = parseWorkshopDate(payload.workshop_date);
  const { is_paid, price_cents, currency } = normalizePaidFields(payload);

  const existingResult = await query(
    `select ${WORKSHOP_SELECT_COLUMNS} from workshops where id = $1::uuid`,
    [workshopId]
  );
  if (existingResult.rows.length === 0) {
    throw new Error('Workshop not found');
  }
  const current = existingResult.rows[0];

  // Reconcile Stripe state. There are four transitions and we have to keep
  // the DB columns and Stripe consistent for each:
  //   was free → still free → no Stripe call
  //   was free → now paid → create product + price (same path as create())
  //   was paid → now free → archive Stripe product, null both ids
  //   was paid → still paid → update product fields; rotate price if amount
  //                            or currency changed (Stripe Prices are
  //                            immutable once created)
  let nextStripeProductId = current.stripe_product_id ?? null;
  let nextStripePriceId = current.stripe_price_id ?? null;
  const stripeClient = options.stripeClient ?? null;
  const getStripe = () => stripeClient ?? StripeWorkshopClient.fromEnv();

  if (!is_paid && current.is_paid) {
    if (current.stripe_product_id) {
      await getStripe().archiveProduct(current.stripe_product_id);
    }
    nextStripeProductId = null;
    nextStripePriceId = null;
  } else if (is_paid && !current.is_paid) {
    const stripe = getStripe();
    nextStripeProductId = await stripe.createProduct({
      slug: payload.slug,
      title: payload.title.trim(),
      description: payload.description ?? payload.short_description ?? null,
      isArchived: payload.status === 'past',
      imageUrl: buildCdnUrl(payload.image_s3_key)
    });
    nextStripePriceId = await stripe.createPrice(nextStripeProductId, price_cents, currency);
  } else if (is_paid && current.is_paid) {
    const stripe = getStripe();
    await stripe.updateProduct(current.stripe_product_id, {
      slug: payload.slug,
      title: payload.title.trim(),
      description: payload.description ?? payload.short_description ?? null,
      isArchived: payload.status === 'past',
      imageUrl: buildCdnUrl(payload.image_s3_key)
    });

    const priceChanged =
      current.price_cents !== price_cents
      || String(current.currency).toLowerCase() !== currency;
    if (priceChanged) {
      nextStripePriceId = await stripe.createPrice(current.stripe_product_id, price_cents, currency);
    }
  }

  await ensureAdminUserRow(auth.userId);
  const result = await query(
    `
      update workshops
         set slug = $2,
             title = $3,
             short_description = $4,
             description = $5,
             status = $6::workshop_status,
             workshop_date = $7,
             location = $8,
             capacity = $9,
             image_s3_key = $10,
             is_paid = $11,
             price_cents = $12,
             currency = $13,
             stripe_product_id = $14,
             stripe_price_id = $15,
             updated_by_user_id = $16::uuid,
             updated_at = now()
       where id = $1::uuid
       returning ${WORKSHOP_SELECT_COLUMNS}
    `,
    [
      workshopId,
      payload.slug,
      payload.title.trim(),
      payload.short_description ?? null,
      payload.description ?? null,
      payload.status,
      workshopDate,
      payload.location ?? null,
      payload.capacity ?? null,
      payload.image_s3_key ?? null,
      is_paid,
      price_cents,
      currency,
      nextStripeProductId,
      nextStripePriceId,
      auth.userId
    ]
  );

  if (result.rows.length === 0) {
    throw new Error('Workshop not found');
  }
  const counts = await loadSignupCountsByWorkshop([workshopId]);
  return mapWorkshopRow(result.rows[0], counts.get(workshopId));
}

export async function deleteWorkshop(event, workshopId, options = {}) {
  const auth = extractAuthContext(event);
  requireAdmin(auth);
  if (!UUID_PATTERN.test(workshopId)) {
    throw new Error('workshop id must be a valid UUID');
  }

  const existing = await query(
    `select stripe_product_id, is_paid from workshops where id = $1::uuid`,
    [workshopId]
  );
  if (existing.rows.length === 0) {
    throw new Error('Workshop not found');
  }
  const current = existing.rows[0];

  // Archive on Stripe first. If this fails we abort the delete: leaving the
  // Stripe product live with no DB row would be worse than retrying the
  // delete later. (The store path doesn't actually delete — it archives,
  // keeping history. Workshops are simpler so we hard-delete the row, but
  // we still want Stripe in a clean state.)
  if (current.is_paid && current.stripe_product_id) {
    const stripe = options.stripeClient ?? StripeWorkshopClient.fromEnv();
    await stripe.archiveProduct(current.stripe_product_id);
  }

  const result = await query(
    `delete from workshops where id = $1::uuid returning id::text as id`,
    [workshopId]
  );
  if (result.rows.length === 0) {
    throw new Error('Workshop not found');
  }
  return { deleted: true, id: workshopId };
}

export async function listWorkshopSignups(event, workshopId) {
  const auth = extractAuthContext(event);
  requireAdmin(auth);
  if (!UUID_PATTERN.test(workshopId)) {
    throw new Error('workshop id must be a valid UUID');
  }

  const exists = await query(
    `select 1 from workshops where id = $1::uuid`,
    [workshopId]
  );
  if (exists.rows.length === 0) {
    throw new Error('Workshop not found');
  }

  const result = await query(
    `
      select s.id::text as id,
             s.workshop_id::text as workshop_id,
             s.user_id::text as user_id,
             s.kind::text as kind,
             s.payment_status::text as payment_status,
             s.amount_cents,
             s.currency,
             s.stripe_checkout_session_id,
             s.paid_at,
             s.cancelled_at,
             s.created_at,
             u.email as user_email,
             u.first_name as user_first_name,
             u.last_name as user_last_name
        from workshop_signups s
        left join users u on u.id = s.user_id
       where s.workshop_id = $1::uuid
       order by s.created_at asc
    `,
    [workshopId]
  );

  // Admin sees cancelled rows in the audit so refunds can be reconciled
  // against the user who paid. The frontend dims them visually.
  return {
    items: result.rows.map((row) => ({
      id: row.id,
      workshop_id: row.workshop_id,
      user_id: row.user_id,
      kind: row.kind,
      payment_status: row.payment_status,
      amount_cents: row.amount_cents,
      currency: row.currency,
      stripe_checkout_session_id: row.stripe_checkout_session_id,
      paid_at: row.paid_at?.toISOString?.() ?? row.paid_at,
      cancelled_at: row.cancelled_at?.toISOString?.() ?? row.cancelled_at,
      user_email: row.user_email,
      user_name: [row.user_first_name, row.user_last_name].filter(Boolean).join(' ').trim() || null,
      created_at: row.created_at?.toISOString?.() ?? row.created_at
    }))
  };
}

export async function createWorkshopImageUploadIntent(event, payload, options = {}) {
  const auth = extractAuthContext(event);
  requireAdmin(auth);

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Request body is required');
  }
  if (!VALID_IMAGE_CONTENT_TYPES.includes(payload.contentType)) {
    throw new Error(`contentType must be one of: ${VALID_IMAGE_CONTENT_TYPES.join(', ')}`);
  }
  if (!Number.isInteger(payload.contentLength) || payload.contentLength <= 0) {
    throw new Error('contentLength must be a positive integer');
  }
  if (payload.contentLength > MAX_IMAGE_BYTES) {
    throw new Error(`contentLength must be ${MAX_IMAGE_BYTES} bytes or fewer`);
  }

  const bucket = getMediaBucketName();
  const imageId = randomUUID();
  const extension = payload.contentType === 'image/png' ? 'png'
    : payload.contentType === 'image/webp' ? 'webp'
    : 'jpg';
  const s3Key = `workshops/${imageId}.${extension}`;

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: s3Key,
    ContentType: payload.contentType,
    ContentLength: payload.contentLength
  });

  const uploadUrl = options.signUploadUrl
    ? await options.signUploadUrl(command, UPLOAD_URL_EXPIRES_SECONDS)
    : await getSignedUrl(new S3Client({ region: getAwsRegion() }), command, {
        expiresIn: UPLOAD_URL_EXPIRES_SECONDS
      });

  return {
    imageId,
    uploadUrl,
    method: 'PUT',
    headers: { 'Content-Type': payload.contentType },
    s3Key,
    expiresInSeconds: UPLOAD_URL_EXPIRES_SECONDS
  };
}

// --- Stripe client ---
//
// Slim Stripe wrapper for paid workshops. Mirrors StripeStoreClient in
// store.mjs but trimmed for the workshop shape (one image, no kind/
// fulfillment_type metadata, no statement descriptor). Form-urlencoded
// against the v1 REST API rather than pulling in the SDK so the deploy
// stays small.

export class StripeWorkshopClient {
  static fromEnv() {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }
    return new StripeWorkshopClient(secretKey);
  }

  constructor(secretKey, fetchImpl = fetch) {
    this.secretKey = secretKey;
    this.fetchImpl = fetchImpl;
  }

  // Build the auth/content-type headers, optionally with an Idempotency-Key.
  // Stripe replays the original response when the same key is reused with
  // the same body, and 409s when the same key is reused with a different
  // body — so callers must derive keys from the request payload, not a
  // random UUID. See sha256Hex below for content-derived keys.
  requestHeaders(idempotencyKey) {
    const headers = {
      authorization: `Basic ${Buffer.from(`${this.secretKey}:`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded'
    };
    if (idempotencyKey) {
      headers['idempotency-key'] = idempotencyKey;
    }
    return headers;
  }

  async parseJson(response) {
    try {
      return await response.json();
    } catch (error) {
      throw new Error(
        `Invalid Stripe response JSON: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  buildProductForm({ slug, title, description, isArchived, imageUrl }) {
    const form = new URLSearchParams();
    form.set('name', title);
    form.set('description', description ?? '');
    form.set('active', isArchived ? 'false' : 'true');
    form.set('metadata[slug]', slug);
    form.set('metadata[kind]', 'workshop');
    if (imageUrl) {
      form.set('images[0]', imageUrl);
    }
    return form;
  }

  async createProduct(payload) {
    // Slug is the natural unique handle for "create this workshop's
    // product." Stripe will replay the original product on retry, so a
    // Lambda timeout retry doesn't end up with two products.
    const idempotencyKey = `workshop-product-create:${payload.slug}`;
    const response = await this.fetchImpl('https://api.stripe.com/v1/products', {
      method: 'POST',
      headers: this.requestHeaders(idempotencyKey),
      body: this.buildProductForm(payload)
    });
    const body = await this.parseJson(response);
    if (!response.ok) {
      throw new Error(`Stripe workshop product creation failed (${response.status}): ${JSON.stringify(body)}`);
    }
    if (!body.id) {
      throw new Error('Stripe product id missing');
    }
    return body.id;
  }

  async updateProduct(stripeProductId, payload) {
    // For updates, key on (product_id, hash of payload). A no-op save
    // (admin clicks save twice without changes) replays. A real change
    // gets a different hash → different key → fresh call.
    const form = this.buildProductForm(payload);
    const idempotencyKey =
      `workshop-product-update:${stripeProductId}:${sha256Hex(form.toString())}`;
    const response = await this.fetchImpl(
      `https://api.stripe.com/v1/products/${encodeURIComponent(stripeProductId)}`,
      {
        method: 'POST',
        headers: this.requestHeaders(idempotencyKey),
        body: form
      }
    );
    const body = await this.parseJson(response);
    if (!response.ok) {
      throw new Error(`Stripe workshop product update failed (${response.status}): ${JSON.stringify(body)}`);
    }
  }

  async createPrice(stripeProductId, unitAmountCents, currency) {
    const form = new URLSearchParams();
    form.set('product', stripeProductId);
    form.set('currency', currency);
    form.set('unit_amount', String(unitAmountCents));

    // (product_id, amount, currency) names this price uniquely. Within
    // Stripe's 24h key window, retries get the same price back instead
    // of stacking duplicate prices on the product.
    const idempotencyKey =
      `workshop-price-create:${stripeProductId}:${unitAmountCents}:${currency}`;
    const response = await this.fetchImpl('https://api.stripe.com/v1/prices', {
      method: 'POST',
      headers: this.requestHeaders(idempotencyKey),
      body: form
    });
    const body = await this.parseJson(response);
    if (!response.ok) {
      throw new Error(`Stripe workshop price creation failed (${response.status}): ${JSON.stringify(body)}`);
    }
    if (!body.id) {
      throw new Error('Stripe price id missing');
    }
    return body.id;
  }

  async archiveProduct(stripeProductId) {
    const form = new URLSearchParams();
    form.set('active', 'false');

    // Archiving the same product twice is naturally idempotent on
    // Stripe's side, but the explicit key keeps logs/metrics clean.
    const idempotencyKey = `workshop-product-archive:${stripeProductId}`;
    const response = await this.fetchImpl(
      `https://api.stripe.com/v1/products/${encodeURIComponent(stripeProductId)}`,
      {
        method: 'POST',
        headers: this.requestHeaders(idempotencyKey),
        body: form
      }
    );
    const body = await this.parseJson(response);
    if (!response.ok) {
      throw new Error(`Stripe workshop product archive failed (${response.status}): ${JSON.stringify(body)}`);
    }
  }
}

function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}
