import { query } from './db.mjs';

const PRODUCT_SELECT_COLUMNS = `
  id, slug, name, short_description, description, status::text as status,
  kind::text as kind, fulfillment_type::text as fulfillment_type,
  is_public, is_featured, currency, unit_amount_cents,
  statement_descriptor, nonprofit_program, impact_summary,
  image_url, metadata, variations, stripe_product_id, stripe_price_id,
  created_at, updated_at
`;

export function mapProduct(row) {
  const images = row.images ?? [];
  const readyImageUrls = images.map((image) => image.url).filter(Boolean);
  const primaryImageUrl = row.image_url ?? readyImageUrls[0] ?? null;
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
    image_url: primaryImageUrl,
    legacy_image_url: row.image_url,
    image_urls: row.image_url ? [row.image_url, ...readyImageUrls] : readyImageUrls,
    images,
    metadata: row.metadata ?? {},
    variations: Array.isArray(row.variations) ? row.variations : [],
    stripe_product_id: row.stripe_product_id,
    stripe_price_id: row.stripe_price_id,
    created_at: row.created_at?.toISOString?.() ?? row.created_at,
    updated_at: row.updated_at?.toISOString?.() ?? row.updated_at
  };
}

function buildCdnUrl(s3Key) {
  if (!s3Key) return null;
  const cdnDomain = process.env.MEDIA_CDN_DOMAIN;
  if (!cdnDomain) return null;
  return `https://${cdnDomain}/${s3Key}`;
}

function mapImageRow(row) {
  return {
    id: row.id,
    product_id: row.product_id,
    status: row.status,
    url: buildCdnUrl(row.normalized_s3_key),
    thumbnail_url: buildCdnUrl(row.thumbnail_s3_key),
    width: row.width,
    height: row.height,
    byte_size: row.byte_size === null || row.byte_size === undefined ? null : Number(row.byte_size),
    sort_order: row.sort_order,
    alt_text: row.alt_text,
    variation_match: row.variation_match ?? {},
    processing_error: null,
    created_at: row.created_at?.toISOString?.() ?? row.created_at,
    updated_at: row.updated_at?.toISOString?.() ?? row.updated_at
  };
}

async function listProductImages(productIds) {
  if (!productIds.length) return new Map();
  const result = await query(
    `
      select id::text as id, product_id::text as product_id, status,
             normalized_s3_key, thumbnail_s3_key, width, height, byte_size,
             sort_order, alt_text, variation_match, created_at, updated_at
        from store_product_images
       where product_id = any($1::uuid[])
         and status = 'ready'
         and deleted_at is null
       order by product_id, sort_order asc, created_at asc
    `,
    [productIds]
  );
  const byProduct = new Map();
  for (const row of result.rows) {
    const existing = byProduct.get(row.product_id) ?? [];
    existing.push(mapImageRow(row));
    byProduct.set(row.product_id, existing);
  }
  return byProduct;
}

async function mapProductRows(rows) {
  const imagesByProduct = await listProductImages(rows.map((row) => row.id));
  return rows.map((row) => mapProduct({ ...row, images: imagesByProduct.get(row.id) ?? [] }));
}

export async function listPublicProducts() {
  const result = await query(
    `select ${PRODUCT_SELECT_COLUMNS}
       from store_products
      where status = 'active' and is_public = true
      order by is_featured desc, created_at desc`
  );
  return { items: await mapProductRows(result.rows) };
}

export async function getPublicProductBySlug(slug) {
  if (typeof slug !== 'string' || slug.trim().length === 0) {
    throw new Error('Validation: slug is required');
  }
  const result = await query(
    `select ${PRODUCT_SELECT_COLUMNS}
       from store_products
      where slug = $1 and status = 'active' and is_public = true
      limit 1`,
    [slug.trim()]
  );
  if (result.rows.length === 0) {
    throw new Error('Product not found');
  }
  return (await mapProductRows([result.rows[0]]))[0];
}

export async function loadProductsForCheckout(productIds) {
  if (!Array.isArray(productIds) || productIds.length === 0) {
    return [];
  }
  const result = await query(
    `select ${PRODUCT_SELECT_COLUMNS}
       from store_products
      where id = any($1::uuid[])`,
    [productIds]
  );
  return result.rows.map(mapProduct);
}
