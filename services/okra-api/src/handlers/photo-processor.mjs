import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Transformer } from '@napi-rs/image';
import { createDbClient } from '../../scripts/db-client.mjs';

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

async function processPhoto(photoId) {
  const client = await createDbClient();
  await client.connect();

  try {
    const photoResult = await client.query(
      `
        select id, submission_id, original_s3_bucket, original_s3_key
        from submission_photos
        where id = $1
      `,
      [photoId]
    );

    const photo = photoResult.rows[0];
    if (!photo) {
      return;
    }

    if (!photo.submission_id) {
      return;
    }

    await client.query(`update submission_photos set status = 'processing', processing_error = null where id = $1`, [photoId]);

    const s3 = new S3Client({ region: getRegion() });
    const originalObj = await s3.send(
      new GetObjectCommand({
        Bucket: photo.original_s3_bucket,
        Key: photo.original_s3_key
      })
    );

    const originalBytes = await streamToBuffer(originalObj.Body);
    const transformer = new Transformer(originalBytes);
    const metadata = await transformer.metadata(true);

    const normalized = await new Transformer(originalBytes).rotate().resize(1600, 1600).webp(82);
    const thumbnail = await new Transformer(originalBytes).rotate().resize(320, 320).webp(75);

    const normalizedKey = `submissions/${photo.submission_id}/${photo.id}/normalized.webp`;
    const thumbnailKey = `submissions/${photo.submission_id}/${photo.id}/thumbnail.webp`;

    await s3.send(
      new PutObjectCommand({
        Bucket: photo.original_s3_bucket,
        Key: normalizedKey,
        Body: normalized,
        ContentType: 'image/webp'
      })
    );

    await s3.send(
      new PutObjectCommand({
        Bucket: photo.original_s3_bucket,
        Key: thumbnailKey,
        Body: thumbnail,
        ContentType: 'image/webp'
      })
    );

    await client.query(
      `
        update submission_photos
        set normalized_s3_bucket = $2,
            normalized_s3_key = $3,
            thumbnail_s3_bucket = $4,
            thumbnail_s3_key = $5,
            mime_type = 'image/webp',
            width = $6,
            height = $7,
            byte_size = $8,
            exif_json = $9,
            status = 'ready',
            processing_error = null
        where id = $1
      `,
      [
        photoId,
        photo.original_s3_bucket,
        normalizedKey,
        photo.original_s3_bucket,
        thumbnailKey,
        metadata.width ?? null,
        metadata.height ?? null,
        normalized.length,
        metadata.exif ? JSON.stringify(metadata.exif) : null
      ]
    );
  } catch (error) {
    await client.query(`update submission_photos set status = 'failed', processing_error = $2 where id = $1`, [
      photoId,
      error instanceof Error ? error.message : String(error)
    ]);
    throw error;
  } finally {
    await client.end();
  }
}

export const handler = async (event) => {
  if (Array.isArray(event?.Records)) {
    for (const record of event.Records) {
      const body = JSON.parse(record.body ?? '{}');
      if (body.photoId) {
        await processPhoto(body.photoId);
      }
    }
    return;
  }

  const photoId = event?.detail?.photoId;
  if (photoId) {
    await processPhoto(photoId);
  }
};
