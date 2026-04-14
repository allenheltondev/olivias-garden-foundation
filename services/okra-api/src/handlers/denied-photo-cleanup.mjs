import { S3Client, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { createDbClient } from '../../scripts/db-client.mjs';

const s3 = new S3Client({});

/**
 * Lambda handler for EventBridge SubmissionDenied events.
 * Extracts submissionId from event.detail and runs cleanup.
 */
export async function handler(event) {
  const { submissionId } = event.detail;
  await processCleanup(submissionId);
}

/**
 * Orchestrates the full cleanup: query photos, delete S3 objects, delete DB rows.
 * Database connection is always closed in the finally block.
 */
async function processCleanup(submissionId) {
  const client = await createDbClient();
  await client.connect();
  try {
    const result = await client.query(
      `SELECT id, original_s3_bucket, original_s3_key,
              normalized_s3_bucket, normalized_s3_key,
              thumbnail_s3_bucket, thumbnail_s3_key
       FROM submission_photos
       WHERE submission_id = $1`,
      [submissionId]
    );
    const photos = result.rows;

    if (photos.length === 0) {
      return; // idempotent no-op
    }

    await deleteS3Objects(photos);
    await deletePhotoRows(client, submissionId);
  } finally {
    await client.end();
  }
}

/**
 * Pure function: collects non-null (bucket, key) pairs from photo rows, grouped by bucket.
 * Exported for property-based testing.
 */
export function collectS3Objects(photos) {
  const objectsByBucket = Object.create(null);
  for (const photo of photos) {
    const pairs = [
      [photo.original_s3_bucket, photo.original_s3_key],
      [photo.normalized_s3_bucket, photo.normalized_s3_key],
      [photo.thumbnail_s3_bucket, photo.thumbnail_s3_key],
    ];
    for (const [bucket, key] of pairs) {
      if (bucket && key) {
        if (!objectsByBucket[bucket]) objectsByBucket[bucket] = [];
        objectsByBucket[bucket].push({ Key: key });
      }
    }
  }
  return objectsByBucket;
}

/**
 * Deletes S3 objects for the given photo rows, batching at most 1000 keys per call.
 * Throws on partial failure so EventBridge retries the invocation.
 */
async function deleteS3Objects(photos) {
  const objectsByBucket = collectS3Objects(photos);

  for (const [bucket, objects] of Object.entries(objectsByBucket)) {
    for (let i = 0; i < objects.length; i += 1000) {
      const batch = objects.slice(i, i + 1000);
      const result = await s3.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch, Quiet: true }
      }));

      if (result.Errors && result.Errors.length > 0) {
        const failedKeys = result.Errors.map(e => e.Key);
        console.error(JSON.stringify({
          level: 'error',
          message: `Failed to delete S3 objects in ${bucket}: ${failedKeys.join(', ')}`,
          bucket,
          failedKeys
        }));
        throw new Error(`Failed to delete S3 objects in ${bucket}: ${failedKeys.join(', ')}`);
      }
    }
  }
}

/**
 * Deletes all submission_photos rows for the given submission ID.
 */
async function deletePhotoRows(client, submissionId) {
  await client.query(
    'DELETE FROM submission_photos WHERE submission_id = $1',
    [submissionId]
  );
}
