import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { query } from '../services/db.mjs';
import { buildCdnUrl, getReadyProductImageUrls } from '../services/store-images.mjs';
import { StripeStoreClient } from '../services/store.mjs';
import { transformToWebpPair } from '../vendor/image-processing/index.mjs';

function getRegion() {
  return process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function syncStripeImages(productId) {
  if (!process.env.STRIPE_SECRET_KEY) return;

  const product = await query(
    `select stripe_product_id from store_products where id = $1::uuid`,
    [productId]
  );
  const stripeProductId = product.rows[0]?.stripe_product_id;
  if (!stripeProductId) return;

  const imageUrls = await getReadyProductImageUrls(productId);
  if (imageUrls.length === 0) return;

  const stripe = StripeStoreClient.fromEnv();
  await stripe.updateProductImages(stripeProductId, imageUrls);
}

async function processStoreImage(imageId) {
  const result = await query(
    `
      select id::text as id, product_id::text as product_id,
             original_s3_bucket, original_s3_key
        from store_product_images
       where id = $1::uuid
    `,
    [imageId]
  );

  const image = result.rows[0];
  if (!image) return;

  try {
    await query(
      `update store_product_images set status = 'processing', processing_error = null, updated_at = now() where id = $1::uuid`,
      [imageId]
    );

    const s3 = new S3Client({ region: getRegion() });
    const originalObj = await s3.send(new GetObjectCommand({
      Bucket: image.original_s3_bucket,
      Key: image.original_s3_key
    }));

    const originalBytes = await streamToBuffer(originalObj.Body);
    const { metadata, main: normalized, thumbnail } = await transformToWebpPair(originalBytes, {
      mainSize: 1800,
      mainQuality: 84,
      thumbnailSize: 480,
      thumbnailQuality: 76
    });

    const normalizedKey = `store-products/${image.product_id ?? 'pending'}/${image.id}/display.webp`;
    const thumbnailKey = `store-products/${image.product_id ?? 'pending'}/${image.id}/thumbnail.webp`;

    await s3.send(new PutObjectCommand({
      Bucket: image.original_s3_bucket,
      Key: normalizedKey,
      Body: normalized,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable'
    }));

    await s3.send(new PutObjectCommand({
      Bucket: image.original_s3_bucket,
      Key: thumbnailKey,
      Body: thumbnail,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable'
    }));

    await query(
      `
        update store_product_images
           set normalized_s3_bucket = $2,
               normalized_s3_key = $3,
               thumbnail_s3_bucket = $2,
               thumbnail_s3_key = $4,
               mime_type = 'image/webp',
               width = $5,
               height = $6,
               byte_size = $7,
               status = 'ready',
               processing_error = null,
               updated_at = now()
         where id = $1::uuid
      `,
      [
        imageId,
        image.original_s3_bucket,
        normalizedKey,
        thumbnailKey,
        metadata.width ?? null,
        metadata.height ?? null,
        normalized.length
      ]
    );

    if (image.product_id && buildCdnUrl(normalizedKey)) {
      await syncStripeImages(image.product_id);
    }
  } catch (error) {
    await query(
      `
        update store_product_images
           set status = 'failed',
               processing_error = $2,
               updated_at = now()
         where id = $1::uuid
      `,
      [imageId, error instanceof Error ? error.message : String(error)]
    );
    throw error;
  }
}

export const handler = async (event) => {
  const detail = event?.detail ?? event;
  const imageId = detail?.imageId;
  if (!imageId) return;
  await processStoreImage(imageId);
};
