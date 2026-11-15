/**
 * Store tools (area `store`): products in the shop, their images, and orders.
 * Products are the admin API's (services/admin-api/src/services/store.mjs);
 * orders are the store API's.
 */

import { z } from 'zod';
import { DESTRUCTIVE, READ, WRITE, ToolError, defined, guarded, idempotencyKey, uuid } from '../shared.mjs';

const STATUSES = ['draft', 'active', 'archived'];
const KINDS = ['donation', 'merchandise', 'ticket', 'sponsorship', 'other'];
const FULFILLMENT = ['none', 'digital', 'shipping', 'pickup'];
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const variation = z.object({
  name: z.string().min(1).max(40).describe('Option name, e.g. "Size".'),
  values: z.array(z.string().min(1).max(60)).min(1).max(50).describe('Choices, e.g. ["S","M","L"].')
});

const imageRef = z.object({
  id: z.uuid().describe('An image id from request_product_image_upload.'),
  alt_text: z.string().max(200).nullish(),
  variation_match: z.record(z.string(), z.string()).optional().describe('Show this image for these option values, e.g. {"Color":"Green"}.')
});

/** Product fields an agent may set. Shared by create (with requirements) and update (all optional). */
const productFields = {
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).describe('URL slug, lowercase kebab-case.'),
  name: z.string().min(1).max(200),
  short_description: z.string().max(500).nullish(),
  description: z.string().max(10_000).nullish(),
  status: z.enum(STATUSES).describe('draft (hidden), active (for sale), archived.'),
  kind: z.enum(KINDS),
  fulfillment_type: z.enum(FULFILLMENT),
  is_public: z.boolean(),
  is_featured: z.boolean(),
  currency: z.string().regex(/^[a-z]{3}$/).describe('Lowercase ISO code, e.g. usd.'),
  unit_amount_cents: z.number().int().min(0).describe('Price in cents: 1500 is $15.00.'),
  statement_descriptor: z.string().max(22).nullish(),
  nonprofit_program: z.string().max(200).nullish(),
  impact_summary: z.string().max(1000).nullish(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  variations: z.array(variation).max(5).optional().describe('Options a buyer picks, e.g. sizes. Replaces all options when given.'),
  images: z.array(imageRef).max(8).optional().describe('Images in display order. Replaces the product\'s images when given.')
};

/** What PUT /admin/store/products/:id needs: the whole product. */
function writablePayload(product) {
  return {
    slug: product.slug,
    name: product.name,
    short_description: product.short_description ?? null,
    description: product.description ?? null,
    status: product.status,
    kind: product.kind,
    fulfillment_type: product.fulfillment_type,
    is_public: product.is_public,
    is_featured: product.is_featured,
    currency: product.currency,
    unit_amount_cents: product.unit_amount_cents,
    statement_descriptor: product.statement_descriptor ?? null,
    nonprofit_program: product.nonprofit_program ?? null,
    impact_summary: product.impact_summary ?? null,
    // `image_url` on a read is derived (falls back to the first uploaded image);
    // the stored column is `legacy_image_url`. Writing the derived one back would
    // pin an uploaded image's URL as the legacy image.
    image_url: product.legacy_image_url ?? null,
    metadata: product.metadata ?? {},
    variations: product.variations ?? [],
    // A PUT without `images` detaches every image, so carry the current ones.
    images: (product.images ?? []).map((image, index) => ({
      id: image.id,
      sort_order: image.sort_order ?? index,
      alt_text: image.alt_text ?? null,
      variation_match: image.variation_match ?? {}
    }))
  };
}

/** The current product merged with only the fields the caller gave. */
export function mergeProductUpdate(current, changes) {
  const base = writablePayload(current);
  const next = { ...base, ...defined(changes) };
  if (changes.images !== undefined) {
    next.images = changes.images.map((image, index) => ({
      id: image.id,
      sort_order: index,
      alt_text: image.alt_text ?? null,
      variation_match: image.variation_match ?? {}
    }));
  }
  return next;
}

/** A compact row for lists: what an operator scans for. */
function summarize(product) {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    status: product.status,
    kind: product.kind,
    price_cents: product.unit_amount_cents,
    currency: product.currency,
    is_public: product.is_public,
    is_featured: product.is_featured,
    image_count: product.images?.length ?? 0,
    variations: (product.variations ?? []).map((v) => v.name),
    updated_at: product.updated_at
  };
}

async function listProducts(backends) {
  const out = await backends.request('admin', { path: '/admin/store/products' });
  return out.items ?? [];
}

async function findProduct(backends, { id, slug }) {
  if (!id && !slug) throw new ToolError('Give the product\'s id or slug.');
  const products = await listProducts(backends);
  const product = products.find((p) => (id ? p.id === id : p.slug === slug));
  if (!product) throw new ToolError(`No store product with ${id ? `id ${id}` : `slug ${slug}`}.`);
  return product;
}

export function registerStoreTools(r, { backends, logger }) {
  const admin = { backends, services: ['admin'] };

  r.register(
    'list_store_products',
    {
      title: 'List store products',
      description: 'Every product in the store, including drafts and archived ones, as compact rows. Filter by status or search name/slug.',
      inputSchema: z.object({
        status: z.enum(STATUSES).optional(),
        search: z.string().max(100).optional().describe('Case-insensitive match on name or slug.')
      }),
      annotations: READ
    },
    guarded(async ({ status, search }) => {
      const needle = search?.toLowerCase();
      const items = (await listProducts(backends))
        .filter((p) => !status || p.status === status)
        .filter((p) => !needle || p.name.toLowerCase().includes(needle) || p.slug.includes(needle))
        .map(summarize);
      return { count: items.length, items };
    }, logger),
    admin
  );

  r.register(
    'get_store_product',
    {
      title: 'Get a store product',
      description: 'One product in full: descriptions, price, options, images, Stripe ids.',
      inputSchema: z.object({ id: z.uuid().optional(), slug: z.string().optional() }),
      annotations: READ
    },
    guarded(async (args) => ({ product: await findProduct(backends, args) }), logger),
    admin
  );

  r.register(
    'create_store_product',
    {
      title: 'Create a store product',
      description:
        'Add a product to the store (it is created in Stripe too). Starts as a draft unless status says otherwise. ' +
        'To add photos: request_product_image_upload, upload, complete_product_image_upload, then pass the image ids in `images`.',
      inputSchema: z.object({
        ...productFields,
        status: productFields.status.default('draft'),
        currency: productFields.currency.default('usd'),
        is_public: productFields.is_public.default(true),
        is_featured: productFields.is_featured.default(false),
        idempotency_key: idempotencyKey
      }),
      annotations: WRITE
    },
    guarded(async ({ idempotency_key, ...fields }) => {
      const product = await backends.request('admin', {
        method: 'POST',
        path: '/admin/store/products',
        body: { metadata: {}, ...fields },
        idempotencyKey: idempotency_key
      });
      return { product };
    }, logger),
    admin
  );

  r.register(
    'update_store_product',
    {
      title: 'Update a store product',
      description:
        'Change some of a product\'s fields; anything not given stays as it is (images and options included). ' +
        'Changing the price makes a new Stripe price. Use status "active" to publish, "draft" to hide.',
      inputSchema: z.object({
        id: uuid('product'),
        ...Object.fromEntries(Object.entries(productFields).map(([k, v]) => [k, v.optional()])),
        idempotency_key: idempotencyKey
      }),
      annotations: WRITE
    },
    guarded(async ({ id, idempotency_key, ...changes }) => {
      const current = await findProduct(backends, { id });
      const product = await backends.request('admin', {
        method: 'PUT',
        path: `/admin/store/products/${id}`,
        body: mergeProductUpdate(current, changes),
        idempotencyKey: idempotency_key
      });
      return { product };
    }, logger),
    admin
  );

  r.register(
    'archive_store_product',
    {
      title: 'Remove (archive) a store product',
      description: 'Take a product out of the store. It is archived, not erased: past orders keep it, and it can be restored with update_store_product status "active".',
      inputSchema: z.object({ id: uuid('product') }),
      annotations: DESTRUCTIVE
    },
    guarded(async ({ id }) => ({
      product: await backends.request('admin', { method: 'DELETE', path: `/admin/store/products/${id}` })
    }), logger),
    admin
  );

  r.register(
    'request_product_image_upload',
    {
      title: 'Get a product image upload URL',
      description:
        'A presigned URL to PUT one image to (valid 15 minutes, max 5 MB). Send the bytes with the returned headers, ' +
        'then call complete_product_image_upload with the imageId, then attach it with update_store_product `images`.',
      inputSchema: z.object({
        content_type: z.enum(IMAGE_TYPES),
        content_length: z.number().int().min(1).max(5 * 1024 * 1024).describe('Exact size in bytes.')
      }),
      annotations: WRITE
    },
    guarded(async ({ content_type, content_length }) =>
      backends.request('admin', {
        method: 'POST',
        path: '/admin/store/product-images',
        body: { contentType: content_type, contentLength: content_length }
      }), logger),
    admin
  );

  r.register(
    'complete_product_image_upload',
    {
      title: 'Finish a product image upload',
      description: 'After the PUT succeeds: starts resizing the image. It is ready to show within a minute.',
      inputSchema: z.object({ image_id: uuid('image') }),
      annotations: WRITE
    },
    guarded(async ({ image_id }) =>
      backends.request('admin', { method: 'POST', path: `/admin/store/product-images/${image_id}/complete`, body: {} }), logger),
    admin
  );

  r.register(
    'list_store_orders',
    {
      title: 'List store orders',
      description: 'Recent store orders (newest first, up to 500): buyer, status, fulfillment, items, totals in cents, shipping address.',
      inputSchema: z.object({
        status: z.enum(['pending', 'paid', 'failed', 'cancelled', 'refunded']).optional(),
        fulfillment_status: z.enum(['unfulfilled', 'fulfilled', 'shipped', 'delivered']).optional(),
        limit: z.number().int().min(1).max(500).default(50)
      }),
      annotations: READ
    },
    guarded(async ({ status, fulfillment_status, limit }) => {
      const out = await backends.request('store', { path: '/admin/orders' });
      const matching = (out.items ?? [])
        .filter((o) => !status || o.status === status)
        .filter((o) => !fulfillment_status || o.fulfillmentStatus === fulfillment_status);
      return { total: matching.length, items: matching.slice(0, limit) };
    }, logger),
    { backends, services: ['store'] }
  );
}
