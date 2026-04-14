import { randomUUID } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const photoCreateSchema = {
  type: 'object',
  required: ['contentType'],
  properties: {
    contentType: {
      type: 'string',
      enum: ['image/jpeg', 'image/png', 'image/webp']
    },
    fileName: {
      type: 'string'
    }
  },
  additionalProperties: false
};

const PHOTO_RATE_LIMIT_WINDOW_SECONDS = Number(
  process.env.PHOTO_RATE_LIMIT_WINDOW_SECONDS ?? 60 * 60
);
const PHOTO_RATE_LIMIT_MAX_REQUESTS = Number(process.env.PHOTO_RATE_LIMIT_MAX_REQUESTS ?? 20);

function getMediaBucketName() {
  const bucket = process.env.MEDIA_BUCKET_NAME;
  if (!bucket) {
    throw new Error('MEDIA_BUCKET_NAME is required');
  }
  return bucket;
}

function getAwsRegion() {
  return process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';
}

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

export async function enforcePhotoRateLimit(client, sourceIp) {
  const ip = sourceIp || 'unknown';

  const result = await client.query(
    `
      select count(*)::int as request_count
      from submission_photos
      where created_by_ip = $1
        and created_at >= now() - ($2::int * interval '1 second')
    `,
    [ip, PHOTO_RATE_LIMIT_WINDOW_SECONDS]
  );

  const requestCount = result.rows[0]?.request_count ?? 0;
  if (requestCount >= PHOTO_RATE_LIMIT_MAX_REQUESTS) {
    const error = new Error('Too many photo upload intent requests. Please wait and try again.');
    error.code = 'PHOTO_RATE_LIMITED';
    error.retryAfterSeconds = PHOTO_RATE_LIMIT_WINDOW_SECONDS;
    throw error;
  }
}

export async function createPhotoUploadIntent(client, payload, sourceIp) {
  const mediaBucket = getMediaBucketName();
  const photoId = randomUUID();
  const objectKey = `temp-photos/${photoId}/original`;

  await client.query(
    `
      insert into submission_photos (
        id,
        submission_id,
        original_s3_bucket,
        original_s3_key,
        mime_type,
        status,
        expires_at,
        created_by_ip
      ) values ($1, null, $2, $3, $4, 'uploaded', now() + interval '1 hour', $5)
    `,
    [photoId, mediaBucket, objectKey, payload.contentType, sourceIp ?? 'unknown']
  );

  const s3 = new S3Client({ region: getAwsRegion() });
  const command = new PutObjectCommand({
    Bucket: mediaBucket,
    Key: objectKey
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 });

  return {
    photoId,
    uploadUrl,
    method: 'PUT',
    headers: {},
    s3Key: objectKey,
    expiresInSeconds: 900
  };
}
