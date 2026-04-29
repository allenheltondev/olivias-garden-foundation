import { randomUUID } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createDbClient } from '../../scripts/db-client.mjs';
import { resolveOptionalAuthContext } from './auth.mjs';
import { enqueueAvatarProcessing } from './avatar-processing-queue.mjs';

export const avatarUploadIntentSchema = {
  type: 'object',
  required: ['contentType'],
  additionalProperties: false,
  properties: {
    contentType: {
      type: 'string',
      enum: ['image/jpeg', 'image/png', 'image/webp']
    }
  }
};

const UPLOAD_URL_EXPIRES_SECONDS = 900;

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

async function requireAuthContext(event) {
  const authContext = await resolveOptionalAuthContext(event);
  if (!authContext?.userId) {
    throw new Error('Authorization token is required');
  }
  return authContext;
}

async function ensureUserRow(client, authContext) {
  await client.query(
    `
      insert into users (id, email, first_name, last_name, display_name)
      values ($1::uuid, $2, $3, $4, $5)
      on conflict (id) do update
        set email = coalesce(excluded.email, users.email),
            first_name = coalesce(users.first_name, excluded.first_name),
            last_name = coalesce(users.last_name, excluded.last_name),
            display_name = coalesce(users.display_name, excluded.display_name),
            updated_at = now()
    `,
    [
      authContext.userId,
      authContext.email ?? null,
      authContext.firstName ?? null,
      authContext.lastName ?? null,
      authContext.name ?? null
    ]
  );
}

export async function createAvatarUploadIntent(event, payload) {
  const authContext = await requireAuthContext(event);
  const mediaBucket = getMediaBucketName();
  const avatarId = randomUUID();
  const objectKey = `avatars/${authContext.userId}/${avatarId}/original`;

  const client = await createDbClient();
  await client.connect();

  try {
    await ensureUserRow(client, authContext);

    await client.query(
      `
        update users
           set avatar_id = $2::uuid,
               avatar_status = 'uploaded',
               avatar_original_s3_bucket = $3,
               avatar_original_s3_key = $4,
               avatar_mime_type = $5,
               avatar_processing_error = null,
               avatar_updated_at = now(),
               updated_at = now()
         where id = $1::uuid
           and deleted_at is null
      `,
      [authContext.userId, avatarId, mediaBucket, objectKey, payload.contentType]
    );
  } finally {
    await client.end();
  }

  const s3 = new S3Client({ region: getAwsRegion() });
  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: mediaBucket,
      Key: objectKey,
      ContentType: payload.contentType
    }),
    { expiresIn: UPLOAD_URL_EXPIRES_SECONDS }
  );

  return {
    avatarId,
    uploadUrl,
    method: 'PUT',
    headers: { 'Content-Type': payload.contentType },
    s3Key: objectKey,
    expiresInSeconds: UPLOAD_URL_EXPIRES_SECONDS
  };
}

export async function completeAvatarUpload(event) {
  const authContext = await requireAuthContext(event);

  const client = await createDbClient();
  await client.connect();

  let avatarId;
  try {
    const result = await client.query(
      `
        update users
           set avatar_status = 'processing',
               avatar_processing_error = null,
               avatar_updated_at = now(),
               updated_at = now()
         where id = $1::uuid
           and deleted_at is null
           and avatar_id is not null
           and avatar_status in ('uploaded', 'failed', 'ready')
         returning avatar_id::text as avatar_id
      `,
      [authContext.userId]
    );

    if (result.rowCount === 0) {
      throw new Error('No uploaded avatar found to process');
    }

    avatarId = result.rows[0].avatar_id;
  } finally {
    await client.end();
  }

  await enqueueAvatarProcessing(authContext.userId, avatarId);

  return { status: 'processing', avatarId };
}
