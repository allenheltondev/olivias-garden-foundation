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

async function processAvatar(userId, avatarId) {
  const client = await createDbClient();
  await client.connect();

  try {
    const row = await client.query(
      `
        select id, avatar_id, avatar_original_s3_bucket, avatar_original_s3_key
          from users
         where id = $1::uuid
           and avatar_id = $2::uuid
           and deleted_at is null
      `,
      [userId, avatarId]
    );

    const user = row.rows[0];
    if (!user || !user.avatar_original_s3_bucket || !user.avatar_original_s3_key) {
      return;
    }

    const s3 = new S3Client({ region: getRegion() });
    const originalObj = await s3.send(
      new GetObjectCommand({
        Bucket: user.avatar_original_s3_bucket,
        Key: user.avatar_original_s3_key
      })
    );

    const originalBytes = await streamToBuffer(originalObj.Body);
    const metadata = await new Transformer(originalBytes).metadata(true);

    const normalized = await new Transformer(originalBytes).rotate().resize(512, 512).webp(82);
    const thumbnail = await new Transformer(originalBytes).rotate().resize(128, 128).webp(75);

    const normalizedKey = `avatars/${userId}/${avatarId}/display.webp`;
    const thumbnailKey = `avatars/${userId}/${avatarId}/thumbnail.webp`;

    await s3.send(new PutObjectCommand({
      Bucket: user.avatar_original_s3_bucket,
      Key: normalizedKey,
      Body: normalized,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable'
    }));

    await s3.send(new PutObjectCommand({
      Bucket: user.avatar_original_s3_bucket,
      Key: thumbnailKey,
      Body: thumbnail,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable'
    }));

    await client.query(
      `
        update users
           set avatar_s3_bucket = $3,
               avatar_s3_key = $4,
               avatar_thumbnail_s3_bucket = $3,
               avatar_thumbnail_s3_key = $5,
               avatar_mime_type = 'image/webp',
               avatar_width = $6,
               avatar_height = $7,
               avatar_byte_size = $8,
               avatar_status = 'ready',
               avatar_processing_error = null,
               avatar_updated_at = now(),
               updated_at = now()
         where id = $1::uuid
           and avatar_id = $2::uuid
      `,
      [
        userId,
        avatarId,
        user.avatar_original_s3_bucket,
        normalizedKey,
        thumbnailKey,
        metadata.width ?? null,
        metadata.height ?? null,
        normalized.length
      ]
    );
  } catch (error) {
    await client.query(
      `
        update users
           set avatar_status = 'failed',
               avatar_processing_error = $3,
               avatar_updated_at = now(),
               updated_at = now()
         where id = $1::uuid
           and avatar_id = $2::uuid
      `,
      [userId, avatarId, error instanceof Error ? error.message : String(error)]
    );
    throw error;
  } finally {
    await client.end();
  }
}

export const handler = async (event) => {
  const detail = event?.detail ?? event;
  const userId = detail?.userId;
  const avatarId = detail?.avatarId;
  if (!userId || !avatarId) {
    return;
  }
  await processAvatar(userId, avatarId);
};
