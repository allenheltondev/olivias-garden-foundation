import { Router } from '@aws-lambda-powertools/event-handler/http';
import {
  IdempotencyAlreadyInProgressError,
  IdempotencyConfig,
  IdempotencyItemAlreadyExistsError,
  makeIdempotent
} from '@aws-lambda-powertools/idempotency';
import { DynamoDBPersistenceLayer } from '@aws-lambda-powertools/idempotency/dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { validate } from '@aws-lambda-powertools/validation';
import { SchemaValidationError } from '@aws-lambda-powertools/validation/errors';
import { S3Client, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { createDbClient } from '../../scripts/db-client.mjs';
import {
  createPhotoUploadIntent,
  enforcePhotoRateLimit,
  photoCreateSchema
} from '../services/photos.mjs';
import { enqueuePhotoProcessing } from '../services/photo-processing-queue.mjs';
import { resolveOptionalContributor } from '../services/auth.mjs';
import {
  deleteContributorSubmission,
  enrichSubmissionPayload,
  insertPendingSubmissionWithPhotos,
  listContributorSubmissions,
  submissionEditSchema,
  submissionSchema,
  submitContributorSubmissionEdit
} from '../services/submissions.mjs';
import {
  createSeedRequest,
  enforceSeedRequestRateLimit,
  publishSeedRequestCreatedEvent,
  seedRequestSchema,
  validateSeedRequest
} from '../services/seed-requests.mjs';
import {
  publishSubmissionCreatedEvent,
  publishSubmissionEditSubmittedEvent
} from '../services/submission-notifications.mjs';
import { getUserActivity } from '../services/user-activity.mjs';

const seedRequestIdempotencyPersistence = new DynamoDBPersistenceLayer({
  tableName: process.env.SEED_REQUESTS_TABLE_NAME ?? '',
  keyAttr: 'requestId',
  expiryAttr: 'expiresAt'
});

const seedRequestIdempotencyConfig = new IdempotencyConfig({
  eventKeyJmesPath: 'headers."Idempotency-Key" || headers."idempotency-key"',
  throwOnNoIdempotencyKey: true,
  expiresAfterSeconds: 60 * 60 * 24
});

// Rate-limit + work live inside the idempotent wrapper so Idempotency-Key replays
// (cached 201s) skip both quota consumption and the actual side effects.
const processSeedRequestIdempotent = makeIdempotent(
  async (event, payload, contributor, correlationId) => {
    const sourceIp = event?.requestContext?.identity?.sourceIp ?? 'unknown';
    await enforceSeedRequestRateLimit(sourceIp);
    const created = await createSeedRequest(payload, contributor);
    await publishSeedRequestCreatedEvent(created, correlationId);
    return {
      requestId: created.requestId,
      createdAt: created.createdAt
    };
  },
  {
    persistenceStore: seedRequestIdempotencyPersistence,
    config: seedRequestIdempotencyConfig,
    dataIndexArgument: 0
  }
);
import { errorResponse, corsHeaders } from '../services/pagination.mjs';
import { fuzzCoordinates } from '../services/privacy-fuzzing.mjs';
import { createHttpRouterHandler, getCorrelationId } from '../services/http-handler.mjs';

const app = new Router();
let statsDynamoClient = null;
const SEED_PACKETS_SENT_COUNTER_KEY = 'stats#seed-packets-sent';
const s3 = new S3Client({});

function getStatsDynamoClient() {
  if (!statsDynamoClient) {
    statsDynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true }
    });
  }
  return statsDynamoClient;
}

async function getSeedPacketsSentCount() {
  const tableName = process.env.SEED_REQUESTS_TABLE_NAME;
  if (!tableName) {
    throw new Error('SEED_REQUESTS_TABLE_NAME is not configured');
  }

  const result = await getStatsDynamoClient().send(new GetCommand({
    TableName: tableName,
    Key: { requestId: SEED_PACKETS_SENT_COUNTER_KEY }
  }));

  return Number(result.Item?.count ?? 0);
}

async function deletePhotoObjectsFromS3(photos, { submissionId, correlationId }) {
  const objectsByBucket = Object.create(null);
  for (const photo of photos) {
    const pairs = [
      [photo.original_s3_bucket, photo.original_s3_key],
      [photo.normalized_s3_bucket, photo.normalized_s3_key],
      [photo.thumbnail_s3_bucket, photo.thumbnail_s3_key]
    ];
    for (const [bucket, key] of pairs) {
      if (bucket && key) {
        if (!objectsByBucket[bucket]) objectsByBucket[bucket] = [];
        objectsByBucket[bucket].push({ Key: key });
      }
    }
  }

  for (const [bucket, objects] of Object.entries(objectsByBucket)) {
    for (let i = 0; i < objects.length; i += 1000) {
      const batch = objects.slice(i, i + 1000);
      try {
        const result = await s3.send(new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: batch, Quiet: true }
        }));

        if (result.Errors && result.Errors.length > 0) {
          console.error(JSON.stringify({
            level: 'warn',
            message: 'Partial S3 cleanup failure for contributor submission delete',
            submissionId,
            bucket,
            failedKeys: result.Errors.map((e) => e.Key),
            correlationId
          }));
        }
      } catch (err) {
        console.error(JSON.stringify({
          level: 'warn',
          message: 'S3 cleanup failed for contributor submission delete',
          submissionId,
          bucket,
          error: err instanceof Error ? err.message : String(err),
          correlationId
        }));
      }
    }
  }
}

app.post('/photos', async ({ req, event }) => {
  const payload = await req.json();

  try {
    validate({ payload, schema: photoCreateSchema });
  } catch (error) {
    if (error instanceof SchemaValidationError) {
      return {
        statusCode: 422,
        body: {
          error: 'RequestValidationError',
          message: 'Validation failed for request',
          details: {
            issues: error.errors?.map((e) => e.message) ?? [error.message]
          }
        }
      };
    }
    throw error;
  }

  const sourceIp = event?.requestContext?.identity?.sourceIp ?? 'unknown';

  const client = await createDbClient();
  await client.connect();

  try {
    await enforcePhotoRateLimit(client, sourceIp);

    const intent = await createPhotoUploadIntent(client, payload, sourceIp);
    return {
      statusCode: 201,
      body: intent
    };
  } catch (error) {
    if (error?.code === 'PHOTO_RATE_LIMITED') {
      return {
        statusCode: 429,
        body: {
          error: 'RateLimitExceeded',
          message: error.message,
          retryAfterSeconds: error.retryAfterSeconds
        }
      };
    }

    throw error;
  } finally {
    await client.end();
  }
});

app.post('/submissions', async ({ req, event }) => {
  const correlationId = getCorrelationId(event);
  let payload;

  try {
    payload = await req.json();
  } catch (error) {
    console.error(JSON.stringify({
      level: 'warn',
      message: 'Invalid JSON body for okra submission',
      errorName: error instanceof Error ? error.name : 'UnknownError',
      endpoint: 'POST /submissions',
      correlationId
    }));
    return {
      statusCode: 400,
      body: {
        error: 'InvalidJson',
        message: 'Request body must be valid JSON'
      }
    };
  }

  try {
    validate({ payload, schema: submissionSchema });
  } catch (error) {
    if (error instanceof SchemaValidationError) {
      return {
        statusCode: 422,
        body: {
          error: 'RequestValidationError',
          message: 'Validation failed for request',
          details: {
            issues: error.errors?.map((e) => e.message) ?? [error.message]
          }
        }
      };
    }
    throw error;
  }

  const authResult = await resolveOptionalContributor(event);
  if (!authResult.ok) {
    return authResult;
  }

  let client;

  try {
    client = await createDbClient();
    await client.connect();

    const created = await insertPendingSubmissionWithPhotos(
      client,
      enrichSubmissionPayload(payload, authResult.contributor)
    );

    await enqueuePhotoProcessing(created.claimedPhotoIds);
    await publishSubmissionCreatedEvent(
      {
        id: created.id,
        status: created.status,
        createdAt: created.created_at,
        contributorName: payload.contributorName ?? authResult.contributor?.name ?? null,
        contributorEmail: payload.contributorEmail ?? authResult.contributor?.email ?? null,
        storyText: payload.storyText ?? null,
        rawLocationText: payload.rawLocationText,
        privacyMode: payload.privacyMode ?? 'city',
        displayLat: payload.displayLat,
        displayLng: payload.displayLng,
        photoUrls: created.claimedPhotos.map((photo) => {
          const cdnDomain = process.env.MEDIA_CDN_DOMAIN;
          if (!cdnDomain || !photo.original_s3_key) {
            return null;
          }

          return `https://${cdnDomain}/${photo.original_s3_key}`;
        }).filter(Boolean)
      },
      correlationId
    );

    return {
      statusCode: 201,
      body: {
        submissionId: created.id,
        status: created.status,
        createdAt: created.created_at
      }
    };
  } catch (error) {
    if (error?.code === 'INVALID_PHOTO_IDS') {
      return {
        statusCode: 422,
        body: {
          error: 'InvalidPhotoIds',
          message: error.message
        }
      };
    }

    if ((error?.message ?? '').includes('Failed to publish')) {
      console.error(JSON.stringify({
        level: 'error',
        message: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : 'UnknownError',
        endpoint: 'POST /submissions',
        correlationId
      }));
      return {
        statusCode: 502,
        body: {
          error: 'PhotoProcessingQueueError',
          message: 'Submission saved but photo processing queueing failed'
        }
      };
    }

    console.error(JSON.stringify({
      level: 'error',
      message: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : 'UnknownError',
      endpoint: 'POST /submissions',
      correlationId
    }));
    return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  } finally {
    await client?.end?.();
  }
});


app.post('/requests', async ({ req, event }) => {
  const idempotencyKey =
    event?.headers?.['Idempotency-Key'] ?? event?.headers?.['idempotency-key'];
  if (!idempotencyKey || String(idempotencyKey).trim().length === 0) {
    return {
      statusCode: 400,
      body: {
        error: 'MissingIdempotencyKey',
        message: 'Idempotency-Key header is required'
      }
    };
  }

  const payload = await req.json();

  try {
    validate({ payload, schema: seedRequestSchema });
  } catch (error) {
    if (error instanceof SchemaValidationError) {
      return {
        statusCode: 422,
        body: {
          error: 'RequestValidationError',
          message: 'Validation failed for request',
          details: {
            issues: error.errors?.map((e) => e.message) ?? [error.message]
          }
        }
      };
    }
    throw error;
  }

  const fulfillmentError = validateSeedRequest(payload);
  if (fulfillmentError) {
    return {
      statusCode: 422,
      body: {
        error: 'RequestValidationError',
        message: fulfillmentError
      }
    };
  }

  const authResult = await resolveOptionalContributor(event);
  if (!authResult.ok) {
    return authResult;
  }

  const correlationId = event?.requestContext?.requestId;

  try {
    if (event?.lambdaContext) {
      seedRequestIdempotencyConfig.registerLambdaContext(event.lambdaContext);
    }

    const result = await processSeedRequestIdempotent(
      event,
      payload,
      authResult.contributor,
      correlationId
    );

    return {
      statusCode: 201,
      body: result
    };
  } catch (error) {
    if (error?.code === 'SEED_REQUEST_RATE_LIMITED') {
      return {
        statusCode: 429,
        body: {
          error: 'RateLimitExceeded',
          message: error.message,
          retryAfterSeconds: error.retryAfterSeconds
        }
      };
    }
    if (
      error instanceof IdempotencyItemAlreadyExistsError ||
      error instanceof IdempotencyAlreadyInProgressError
    ) {
      return {
        statusCode: 409,
        body: {
          error: 'IdempotencyInProgress',
          message: 'A request with this Idempotency-Key is already being processed'
        }
      };
    }
    console.error(JSON.stringify({
      level: 'error',
      correlationId,
      endpoint: 'POST /requests',
      message: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : 'UnknownError'
    }));
    throw error;
  }
});

app.get('/', async () => {
  const cdnDomain = process.env.MEDIA_CDN_DOMAIN;
  if (!cdnDomain) {
    console.error(JSON.stringify({
      level: 'warn',
      message: 'MEDIA_CDN_DOMAIN not set â€” photo URLs will be empty',
      endpoint: 'GET /okra'
    }));
  }

  const client = await createDbClient();
  await client.connect();
  try {
    const res = await client.query(
      `SELECT s.id, s.contributor_name, s.story_text, s.privacy_mode,
              s.display_lat, s.display_lng, s.country, s.edit_count, s.edited_at
       FROM submissions s
       WHERE s.status = 'approved'
         AND NOT (s.display_lat = 0 AND s.display_lng = 0)
       ORDER BY s.created_at DESC, s.id DESC`
    );
    const rows = res.rows;

    // Batch-fetch thumbnail photos grouped by submission_id
    const submissionIds = rows.map(r => r.id);
    let photoMap = {};
    if (submissionIds.length > 0 && cdnDomain) {
      const photoRes = await client.query(
        `SELECT submission_id, thumbnail_s3_key
         FROM submission_photos
         WHERE submission_id = ANY($1)
           AND status = 'ready'
           AND removed_at IS NULL
           AND review_status = 'approved'
           AND NOT EXISTS (
             SELECT 1
               FROM submission_edit_photos sep
               JOIN submission_edits se ON se.id = sep.edit_id
              WHERE sep.photo_id = submission_photos.id
                AND sep.action = 'add'
                AND se.status <> 'approved'
           )
         ORDER BY submission_id, created_at ASC`,
        [submissionIds]
      );
      for (const photo of photoRes.rows) {
        if (!photoMap[photo.submission_id]) {
          photoMap[photo.submission_id] = [];
        }
        photoMap[photo.submission_id].push(`https://${cdnDomain}/${photo.thumbnail_s3_key}`);
      }
    }

    const data = rows.map(row => {
      const fuzzed = fuzzCoordinates(row.id, row.display_lat, row.display_lng, row.privacy_mode);
      return {
        id: row.id,
        display_lat: fuzzed.lat,
        display_lng: fuzzed.lng,
        contributor_name: row.contributor_name,
        story_text: row.story_text,
        edited: Number(row.edit_count ?? 0) > 0,
        edited_at: row.edited_at,
        country: row.country || null,
        photo_urls: photoMap[row.id] || []
      };
    });

    return new Response(
      JSON.stringify({ total_count: data.length, data }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'public, max-age=300, stale-while-revalidate=60',
          ...corsHeaders
        }
      }
    );
  } catch (err) {
    console.error(JSON.stringify({
      level: 'error',
      message: err instanceof Error ? err.message : String(err),
      errorName: err instanceof Error ? err.name : 'UnknownError',
      endpoint: 'GET /okra'
    }));
    return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  } finally {
    await client.end();
  }
});

app.get('/stats', async () => {
  const client = await createDbClient();
  await client.connect();
  try {
    const [res, seedPacketsSent] = await Promise.all([
      client.query(
        `SELECT
           COUNT(*)::int AS total_pins,
           COUNT(DISTINCT country)::int AS country_count,
           COUNT(DISTINCT contributor_name) FILTER (WHERE contributor_name IS NOT NULL AND contributor_name <> '')::int AS contributor_count
         FROM submissions
         WHERE status = 'approved'
           AND NOT (display_lat = 0 AND display_lng = 0)`
      ),
      getSeedPacketsSentCount()
    ]);
    const { total_pins, country_count, contributor_count } = res.rows[0];
    return new Response(
      JSON.stringify({ total_pins, country_count, contributor_count, seed_packets_sent: seedPacketsSent }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'public, max-age=300, stale-while-revalidate=60',
          ...corsHeaders
        }
      }
    );
  } catch (err) {
    console.error(JSON.stringify({
      level: 'error',
      message: err instanceof Error ? err.message : String(err),
      errorName: err instanceof Error ? err.name : 'UnknownError',
      endpoint: 'GET /okra/stats'
    }));
    return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  } finally {
    await client.end();
  }
});

app.get('/me/activity', async ({ event }) => {
  const authResult = await resolveOptionalContributor(event);
  if (!authResult.ok) {
    return authResult;
  }

  const cognitoSub = authResult.contributor?.sub;
  if (!cognitoSub) {
    return {
      statusCode: 401,
      body: {
        error: 'Unauthorized',
        message: 'Sign in to view your activity'
      }
    };
  }

  const client = await createDbClient();
  await client.connect();

  try {
    const activity = await getUserActivity(client, cognitoSub);
    return {
      statusCode: 200,
      body: activity
    };
  } finally {
    await client.end();
  }
});

app.get('/me/submissions', async ({ event }) => {
  const authResult = await resolveOptionalContributor(event);
  if (!authResult.ok) {
    return authResult;
  }

  const cognitoSub = authResult.contributor?.sub;
  if (!cognitoSub) {
    return errorResponse(401, 'UNAUTHORIZED', 'Sign in to view your okra submissions');
  }

  const client = await createDbClient();
  await client.connect();

  try {
    const submissions = await listContributorSubmissions(
      client,
      cognitoSub,
      process.env.MEDIA_CDN_DOMAIN
    );
    return {
      statusCode: 200,
      body: { submissions }
    };
  } finally {
    await client.end();
  }
});

app.patch('/me/submissions/:id', async ({ req, event, params }) => {
  const correlationId = getCorrelationId(event);
  const authResult = await resolveOptionalContributor(event);
  if (!authResult.ok) {
    return authResult;
  }

  const cognitoSub = authResult.contributor?.sub;
  if (!cognitoSub) {
    return errorResponse(401, 'UNAUTHORIZED', 'Sign in to edit your okra submission');
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return errorResponse(400, 'INVALID_JSON', 'Request body must be valid JSON');
  }

  try {
    validate({ payload, schema: submissionEditSchema });
  } catch (error) {
    if (error instanceof SchemaValidationError) {
      return {
        statusCode: 422,
        body: {
          error: 'RequestValidationError',
          message: 'Validation failed for request',
          details: {
            issues: error.errors?.map((e) => e.message) ?? [error.message]
          }
        }
      };
    }
    throw error;
  }

  let client;
  try {
    client = await createDbClient();
    await client.connect();
    const result = await submitContributorSubmissionEdit(client, params.id, cognitoSub, payload);
    if (result.queuedPhotoIds.length > 0) {
      await enqueuePhotoProcessing(result.queuedPhotoIds);
    }
    if (!result.idempotentReplay) {
      await publishSubmissionEditSubmittedEvent(result, correlationId);
    }
    return {
      statusCode: 202,
      body: {
        submissionId: result.submissionId,
        editId: result.editId,
        status: result.status,
        createdAt: result.createdAt
      }
    };
  } catch (error) {
    if (error?.code === 'SUBMISSION_NOT_FOUND') {
      return errorResponse(404, 'NOT_FOUND', 'Submission not found');
    }
    if (error?.code === 'INVALID_PHOTO_IDS' || error?.code === 'MISSING_PHOTOS') {
      return errorResponse(
        422,
        error.code === 'MISSING_PHOTOS' ? 'MISSING_PHOTOS' : 'INVALID_PHOTO_IDS',
        error.message
      );
    }
    console.error(JSON.stringify({
      level: 'error',
      message: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : 'UnknownError',
      endpoint: 'PATCH /me/submissions/:id',
      submissionId: params.id,
      correlationId
    }));
    return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  } finally {
    await client?.end?.();
  }
});

app.delete('/me/submissions/:id', async ({ event, params }) => {
  const correlationId = getCorrelationId(event);
  const authResult = await resolveOptionalContributor(event);
  if (!authResult.ok) {
    return authResult;
  }

  const cognitoSub = authResult.contributor?.sub;
  if (!cognitoSub) {
    return errorResponse(401, 'UNAUTHORIZED', 'Sign in to delete your okra submission');
  }

  let client;
  try {
    client = await createDbClient();
    await client.connect();
    const { photos } = await deleteContributorSubmission(client, params.id, cognitoSub);
    await client.end();
    client = null;

    if (photos.length > 0) {
      await deletePhotoObjectsFromS3(photos, { submissionId: params.id, correlationId });
    }

    return { statusCode: 204 };
  } catch (error) {
    if (error?.code === 'SUBMISSION_NOT_FOUND') {
      return errorResponse(404, 'NOT_FOUND', 'Submission not found');
    }
    console.error(JSON.stringify({
      level: 'error',
      message: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : 'UnknownError',
      endpoint: 'DELETE /me/submissions/:id',
      submissionId: params.id,
      correlationId
    }));
    return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  } finally {
    await client?.end?.();
  }
});

app.notFound(() => {
  return new Response(
    JSON.stringify({
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found'
      }
    }),
    {
      status: 404,
      headers: {
        'content-type': 'application/json',
        ...corsHeaders
      }
    }
  );
});

export const handler = createHttpRouterHandler({ app, handlerName: 'public-api', basePath: '/okra' });
