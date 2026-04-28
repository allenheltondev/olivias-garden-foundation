import { randomUUID } from 'node:crypto';
import { DeleteObjectsCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { extractAuthContext, requireAdmin } from './auth.mjs';
import { query } from './db.mjs';
import { enqueueStoreImageProcessing } from './store-image-processing-queue.mjs';

const VALID_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const UPLOAD_URL_EXPIRES_SECONDS = 900;
export const MAX_PRODUCT_IMAGES = 8;
export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getMediaBucketName() {
  const bucket = process.env.MEDIA_BUCKET_NAME;
  if (!bucket) {
    throw new Error('MEDIA_BUCKET_NAME is not configured');
  }
  return bucket;
}

function getAwsRegion() {
  return process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';
}

export function buildCdnUrl(s3Key) {
  if (!s3Key) return null;
  const cdnDomain = process.env.MEDIA_CDN_DOMAIN;
  if (!cdnDomain) return null;
  return `https://${cdnDomain}/${s3Key}`;
}

function validateImageUploadPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Request body is required');
  }

  if (!VALID_CONTENT_TYPES.includes(payload.contentType)) {
    throw new Error(`contentType must be one of: ${VALID_CONTENT_TYPES.join(', ')}`);
  }
  if (!Number.isInteger(payload.contentLength) || payload.contentLength <= 0) {
    throw new Error('contentLength must be a positive integer');
  }
  if (payload.contentLength > MAX_PRODUCT_IMAGE_BYTES) {
    throw new Error(`contentLength must be ${MAX_PRODUCT_IMAGE_BYTES} bytes or fewer`);
  }
}

export function normalizeProductImageInputs(images) {
  if (images === undefined || images === null) return [];
  if (!Array.isArray(images)) {
    throw new Error('images must be an array');
  }
  if (images.length > MAX_PRODUCT_IMAGES) {
    throw new Error(`images must contain ${MAX_PRODUCT_IMAGES} or fewer items`);
  }

  return images.map((image, index) => {
    if (!image || typeof image !== 'object' || Array.isArray(image)) {
      throw new Error('each image must be an object');
    }
    if (typeof image.id !== 'string' || !UUID_PATTERN.test(image.id)) {
      throw new Error('image id must be a valid UUID');
    }
    if (image.alt_text !== undefined && image.alt_text !== null && typeof image.alt_text !== 'string') {
      throw new Error('image alt_text must be a string');
    }
    if (image.alt_text && image.alt_text.length > 200) {
      throw new Error('image alt_text must be 200 characters or fewer');
    }

    return {
      id: image.id,
      sort_order: Number.isInteger(image.sort_order) ? image.sort_order : index,
      alt_text: image.alt_text ?? null,
      variation_match: normalizeVariationMatch(image.variation_match)
    };
  });
}

function normalizeVariationMatch(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('image variation_match must be an object');
  }
  const normalized = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof key !== 'string' || key.length === 0 || key.length > 60) {
      throw new Error('image variation_match keys must be 1–60 character strings');
    }
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 100) {
      throw new Error('image variation_match values must be 1–100 character strings');
    }
    normalized[key] = raw;
  }
  return normalized;
}

// Cross-checks each image's variation_match against the product's defined
// variations so we never persist tags pointing at options that don't exist.
// Called from create/update after both the variations and image inputs have
// been validated in isolation.
export function assertImageVariationMatchesAreValid(imageInputs, variations = []) {
  const allowed = new Map(
    (variations ?? []).map((variation) => [variation.name, new Set(variation.values)])
  );
  for (const image of imageInputs) {
    const match = image.variation_match ?? {};
    for (const [name, value] of Object.entries(match)) {
      const values = allowed.get(name);
      if (!values) {
        throw new Error(`image references variation "${name}" that is not defined on the product`);
      }
      if (!values.has(value)) {
        throw new Error(`image references "${value}" which is not a value of "${name}"`);
      }
    }
  }
}

function mapImageRow(row) {
  const url = buildCdnUrl(row.normalized_s3_key);
  const thumbnailUrl = buildCdnUrl(row.thumbnail_s3_key);
  return {
    id: row.id,
    product_id: row.product_id,
    status: row.status,
    url,
    thumbnail_url: thumbnailUrl,
    width: row.width,
    height: row.height,
    byte_size: row.byte_size === null || row.byte_size === undefined ? null : Number(row.byte_size),
    sort_order: row.sort_order,
    alt_text: row.alt_text,
    variation_match: row.variation_match ?? {},
    processing_error: row.processing_error,
    created_at: row.created_at?.toISOString?.() ?? row.created_at,
    updated_at: row.updated_at?.toISOString?.() ?? row.updated_at
  };
}

export async function createStoreProductImageUploadIntent(event, payload, options = {}) {
  const auth = extractAuthContext(event);
  requireAdmin(auth);
  validateImageUploadPayload(payload);

  const mediaBucket = getMediaBucketName();
  const imageId = randomUUID();
  const objectKey = `store-products/pending/${imageId}/original`;

  const db = options.db ?? { query };
  await db.query(
    `
      insert into store_product_images (
        id, original_s3_bucket, original_s3_key, mime_type, original_byte_size, status, expires_at
      ) values ($1::uuid, $2, $3, $4, $5, 'uploaded', now() + interval '1 hour')
    `,
    [imageId, mediaBucket, objectKey, payload.contentType, payload.contentLength]
  );

  const command = new PutObjectCommand({
    Bucket: mediaBucket,
    Key: objectKey,
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
    s3Key: objectKey,
    expiresInSeconds: UPLOAD_URL_EXPIRES_SECONDS
  };
}

export async function completeStoreProductImageUpload(event, imageId, options = {}) {
  const auth = extractAuthContext(event);
  requireAdmin(auth);

  if (!UUID_PATTERN.test(imageId)) {
    throw new Error('image id must be a valid UUID');
  }

  const db = options.db ?? { query };
  const result = await db.query(
    `
      update store_product_images
         set status = 'processing',
             processing_error = null,
             updated_at = now()
       where id = $1::uuid
         and status in ('uploaded', 'failed', 'ready')
       returning id
    `,
    [imageId]
  );

  if (result.rowCount === 0) {
    throw new Error('Store product image not found');
  }

  const enqueue = options.enqueue ?? enqueueStoreImageProcessing;
  await enqueue(imageId);

  return { status: 'processing', imageId };
}

export async function associateProductImages(productId, imageInputs, db = { query }) {
  const images = normalizeProductImageInputs(imageInputs);

  await db.query(
    `
      update store_product_images
         set product_id = null,
             sort_order = 0,
             deleted_at = now(),
             expires_at = now() + interval '7 days',
             updated_at = now()
       where product_id = $1::uuid
    `,
    [productId]
  );

  for (const image of images) {
    const result = await db.query(
      `
        update store_product_images
           set product_id = $2::uuid,
               sort_order = $3,
               alt_text = $4,
               variation_match = $5::jsonb,
               deleted_at = null,
               expires_at = null,
               updated_at = now()
         where id = $1::uuid
           and (product_id is null or product_id = $2::uuid)
         returning id
      `,
      [
        image.id,
        productId,
        image.sort_order,
        image.alt_text,
        JSON.stringify(image.variation_match ?? {})
      ]
    );

    if (result.rowCount === 0) {
      throw new Error('Store product image not found');
    }
  }
}

export async function cleanupExpiredStoreProductImages(limit = 100) {
  const result = await query(
    `
      select id::text as id, original_s3_bucket, original_s3_key,
             normalized_s3_key, thumbnail_s3_key
        from store_product_images
       where expires_at is not null
         and expires_at <= now()
       order by expires_at asc
       limit $1
    `,
    [limit]
  );

  const byBucket = new Map();
  for (const row of result.rows) {
    const objects = [row.original_s3_key, row.normalized_s3_key, row.thumbnail_s3_key]
      .filter(Boolean)
      .map((Key) => ({ Key }));
    if (objects.length === 0) continue;
    const bucketObjects = byBucket.get(row.original_s3_bucket) ?? [];
    bucketObjects.push(...objects);
    byBucket.set(row.original_s3_bucket, bucketObjects);
  }

  const s3 = new S3Client({ region: getAwsRegion() });
  for (const [Bucket, Objects] of byBucket.entries()) {
    await s3.send(new DeleteObjectsCommand({
      Bucket,
      Delete: { Objects, Quiet: true }
    }));
  }

  if (result.rows.length > 0) {
    await query(
      `delete from store_product_images where id = any($1::uuid[])`,
      [result.rows.map((row) => row.id)]
    );
  }

  return { deletedCount: result.rows.length };
}

export async function listProductImages(productIds) {
  if (!productIds.length) return new Map();

  const result = await query(
    `
      select id::text as id, product_id::text as product_id, status,
             normalized_s3_key, thumbnail_s3_key, width, height, byte_size,
             sort_order, alt_text, variation_match, processing_error,
             created_at, updated_at
        from store_product_images
       where product_id = any($1::uuid[])
       order by product_id, sort_order asc, created_at asc
    `,
    [productIds]
  );

  const byProduct = new Map();
  for (const row of result.rows) {
    const mapped = mapImageRow(row);
    const existing = byProduct.get(row.product_id) ?? [];
    existing.push(mapped);
    byProduct.set(row.product_id, existing);
  }
  return byProduct;
}

export async function getReadyProductImageUrls(productId) {
  const result = await query(
    `
      select normalized_s3_key
        from store_product_images
       where product_id = $1::uuid
         and status = 'ready'
         and normalized_s3_key is not null
       order by sort_order asc, created_at asc
       limit 8
    `,
    [productId]
  );

  return result.rows.map((row) => buildCdnUrl(row.normalized_s3_key)).filter(Boolean);
}
