import { extractAuthContext, requireAdmin } from './auth.mjs';
import { query } from './db.mjs';

const VALID_STATUSES = ['draft', 'active', 'archived'];
const VALID_KINDS = ['donation', 'merchandise', 'ticket', 'sponsorship', 'other'];
const VALID_FULFILLMENT_TYPES = ['none', 'digital', 'shipping', 'pickup'];
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PRODUCT_SELECT_COLUMNS = `
  id, slug, name, short_description, description, status::text as status,
  kind::text as kind, fulfillment_type::text as fulfillment_type,
  is_public, is_featured, currency, unit_amount_cents,
  statement_descriptor, nonprofit_program, impact_summary,
  image_url, metadata, stripe_product_id, stripe_price_id,
  created_at, updated_at
`;

export function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Request body is required');
  }

  if (typeof payload.slug !== 'string' || payload.slug.trim().length === 0 || !isSlug(payload.slug)) {
    throw new Error('slug must be lowercase kebab-case');
  }

  if (typeof payload.name !== 'string' || payload.name.trim().length === 0) {
    throw new Error('name is required');
  }

  if (!VALID_STATUSES.includes(payload.status)) {
    throw new Error(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  if (!VALID_KINDS.includes(payload.kind)) {
    throw new Error(`kind must be one of: ${VALID_KINDS.join(', ')}`);
  }

  if (!VALID_FULFILLMENT_TYPES.includes(payload.fulfillment_type)) {
    throw new Error(`fulfillmentType must be one of: ${VALID_FULFILLMENT_TYPES.join(', ')}`);
  }

  if (
    typeof payload.currency !== 'string'
    || payload.currency.length !== 3
    || !/^[a-z]{3}$/.test(payload.currency)
  ) {
    throw new Error('currency must be a 3-letter lowercase ISO code');
  }

  if (!Number.isInteger(payload.unit_amount_cents) || payload.unit_amount_cents < 0) {
    throw new Error('unitAmountCents must be greater than or equal to 0');
  }

  if (!isPlainObject(payload.metadata ?? {})) {
    throw new Error('metadata must be a JSON object');
  }
}

function isSlug(value) {
  const trimmed = value.trim();
  return (
    trimmed === value
    && trimmed.length > 0
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed)
  );
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapStoreProduct(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    short_description: row.short_description,
    description: row.description,
    status: row.status,
    kind: row.kind,
    fulfillment_type: row.fulfillment_type,
    is_public: row.is_public,
    is_featured: row.is_featured,
    currency: row.currency,
    unit_amount_cents: row.unit_amount_cents,
    statement_descriptor: row.statement_descriptor,
    nonprofit_program: row.nonprofit_program,
    impact_summary: row.impact_summary,
    image_url: row.image_url,
    metadata: row.metadata ?? {},
    stripe_product_id: row.stripe_product_id,
    stripe_price_id: row.stripe_price_id,
    created_at: row.created_at?.toISOString?.() ?? row.created_at,
    updated_at: row.updated_at?.toISOString?.() ?? row.updated_at
  };
}

export async function listPublicProducts() {
  const result = await query(
    `
      select ${PRODUCT_SELECT_COLUMNS}
        from store_products
       where status = 'active' and is_public = true
       order by is_featured desc, created_at desc
    `
  );

  return { items: result.rows.map(mapStoreProduct) };
}

export async function listAdminProducts(event) {
  const auth = extractAuthContext(event);
  requireAdmin(auth);

  const result = await query(
    `
      select ${PRODUCT_SELECT_COLUMNS}
        from store_products
       order by updated_at desc, created_at desc
    `
  );

  return { items: result.rows.map(mapStoreProduct) };
}

export async function createStoreProduct(event, payload, options = {}) {
  const auth = extractAuthContext(event);
  requireAdmin(auth);
  validatePayload(payload);

  const stripe = options.stripeClient ?? StripeStoreClient.fromEnv();
  const stripeProductId = await stripe.createProduct(payload);
  const stripePriceId = await stripe.createPrice(
    stripeProductId,
    payload.unit_amount_cents,
    payload.currency
  );

  const result = await query(
    `
      insert into store_products (
        slug, name, short_description, description, status, kind, fulfillment_type,
        is_public, is_featured, currency, unit_amount_cents, statement_descriptor,
        nonprofit_program, impact_summary, image_url, metadata,
        stripe_product_id, stripe_price_id
      )
      values (
        $1, $2, $3, $4, $5::store_product_status, $6::store_product_kind,
        $7::store_fulfillment_type, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
      )
      returning ${PRODUCT_SELECT_COLUMNS}
    `,
    [
      payload.slug,
      payload.name,
      payload.short_description ?? null,
      payload.description ?? null,
      payload.status,
      payload.kind,
      payload.fulfillment_type,
      payload.is_public,
      payload.is_featured,
      payload.currency,
      payload.unit_amount_cents,
      payload.statement_descriptor ?? null,
      payload.nonprofit_program ?? null,
      payload.impact_summary ?? null,
      payload.image_url ?? null,
      payload.metadata ?? {},
      stripeProductId,
      stripePriceId
    ]
  );

  return mapStoreProduct(result.rows[0]);
}

export async function updateStoreProduct(event, payload, productId, options = {}) {
  const auth = extractAuthContext(event);
  requireAdmin(auth);

  if (!UUID_PATTERN.test(productId)) {
    throw new Error('product id must be a valid UUID');
  }

  validatePayload(payload);

  const existing = await query(
    `
      select stripe_product_id, stripe_price_id, unit_amount_cents, currency
        from store_products
       where id = $1
    `,
    [productId]
  );

  if (existing.rows.length === 0) {
    throw new Error('Store product not found');
  }

  const current = existing.rows[0];
  const stripe = options.stripeClient ?? StripeStoreClient.fromEnv();
  await stripe.updateProduct(current.stripe_product_id, payload);

  const stripePriceId =
    current.unit_amount_cents !== payload.unit_amount_cents
    || String(current.currency).toLowerCase() !== payload.currency.toLowerCase()
      ? await stripe.createPrice(
          current.stripe_product_id,
          payload.unit_amount_cents,
          payload.currency
        )
      : current.stripe_price_id;

  const updated = await query(
    `
      update store_products
         set slug = $2,
             name = $3,
             short_description = $4,
             description = $5,
             status = $6::store_product_status,
             kind = $7::store_product_kind,
             fulfillment_type = $8::store_fulfillment_type,
             is_public = $9,
             is_featured = $10,
             currency = $11,
             unit_amount_cents = $12,
             statement_descriptor = $13,
             nonprofit_program = $14,
             impact_summary = $15,
             image_url = $16,
             metadata = $17,
             stripe_price_id = $18,
             updated_at = now()
       where id = $1
       returning ${PRODUCT_SELECT_COLUMNS}
    `,
    [
      productId,
      payload.slug,
      payload.name,
      payload.short_description ?? null,
      payload.description ?? null,
      payload.status,
      payload.kind,
      payload.fulfillment_type,
      payload.is_public,
      payload.is_featured,
      payload.currency,
      payload.unit_amount_cents,
      payload.statement_descriptor ?? null,
      payload.nonprofit_program ?? null,
      payload.impact_summary ?? null,
      payload.image_url ?? null,
      payload.metadata ?? {},
      stripePriceId
    ]
  );

  return mapStoreProduct(updated.rows[0]);
}

export class StripeStoreClient {
  static fromEnv() {
    const secretKey = process.env.STRIPE_SECRET_KEY;

    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }

    return new StripeStoreClient(secretKey);
  }

  constructor(secretKey, fetchImpl = fetch) {
    this.secretKey = secretKey;
    this.fetchImpl = fetchImpl;
  }

  async createProduct(payload) {
    const form = new URLSearchParams(this.baseProductForm(payload));
    form.set('default_price_data[currency]', payload.currency);
    form.set('default_price_data[unit_amount]', String(payload.unit_amount_cents));

    const response = await this.fetchImpl('https://api.stripe.com/v1/products', {
      method: 'POST',
      headers: this.requestHeaders(),
      body: form
    });

    const body = await this.parseJson(response);

    if (!response.ok) {
      throw new Error(`Stripe product creation failed (${response.status}): ${JSON.stringify(body)}`);
    }

    if (!body.id) {
      throw new Error('Stripe product id missing');
    }

    return body.id;
  }

  async createPrice(stripeProductId, unitAmountCents, currency) {
    const form = new URLSearchParams();
    form.set('product', stripeProductId);
    form.set('currency', currency);
    form.set('unit_amount', String(unitAmountCents));

    const response = await this.fetchImpl('https://api.stripe.com/v1/prices', {
      method: 'POST',
      headers: this.requestHeaders(),
      body: form
    });

    const body = await this.parseJson(response);

    if (!response.ok) {
      throw new Error(`Stripe price creation failed (${response.status}): ${JSON.stringify(body)}`);
    }

    if (!body.id) {
      throw new Error('Stripe price id missing');
    }

    return body.id;
  }

  async updateProduct(stripeProductId, payload) {
    const response = await this.fetchImpl(
      `https://api.stripe.com/v1/products/${stripeProductId}`,
      {
        method: 'POST',
        headers: this.requestHeaders(),
        body: new URLSearchParams(this.baseProductForm(payload))
      }
    );

    const body = await this.parseJson(response);

    if (!response.ok) {
      throw new Error(`Stripe product update failed (${response.status}): ${JSON.stringify(body)}`);
    }
  }

  requestHeaders() {
    return {
      authorization: `Basic ${Buffer.from(`${this.secretKey}:`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded'
    };
  }

  baseProductForm(payload) {
    const form = new URLSearchParams();
    form.set('name', payload.name);
    form.set('description', payload.description ?? '');
    form.set('active', payload.status === 'archived' ? 'false' : 'true');
    form.set('metadata[slug]', payload.slug);
    form.set('metadata[kind]', payload.kind);
    form.set('metadata[nonprofit_program]', payload.nonprofit_program ?? '');
    form.set('metadata[impact_summary]', payload.impact_summary ?? '');

    if (payload.image_url) {
      form.set('images[0]', payload.image_url);
    }

    return form;
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
}
