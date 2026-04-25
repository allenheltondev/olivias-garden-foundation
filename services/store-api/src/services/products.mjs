import { query } from './db.mjs';

const PRODUCT_SELECT_COLUMNS = `
  id, slug, name, short_description, description, status::text as status,
  kind::text as kind, fulfillment_type::text as fulfillment_type,
  is_public, is_featured, currency, unit_amount_cents,
  statement_descriptor, nonprofit_program, impact_summary,
  image_url, metadata, stripe_product_id, stripe_price_id,
  created_at, updated_at
`;

function mapProduct(row) {
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
    `select ${PRODUCT_SELECT_COLUMNS}
       from store_products
      where status = 'active' and is_public = true
      order by is_featured desc, created_at desc`
  );
  return { items: result.rows.map(mapProduct) };
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
  return mapProduct(result.rows[0]);
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
