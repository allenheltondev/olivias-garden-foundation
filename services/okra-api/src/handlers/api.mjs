import { Router } from '@aws-lambda-powertools/event-handler/http';
import { validate } from '@aws-lambda-powertools/validation';
import { SchemaValidationError } from '@aws-lambda-powertools/validation/errors';
import { createDbClient } from '../../scripts/db-client.mjs';
import {
  createPhotoUploadIntent,
  enforcePhotoRateLimit,
  photoCreateSchema
} from '../services/photos.mjs';
import { enqueuePhotoProcessing } from '../services/photo-processing-queue.mjs';
import { resolveOptionalContributor } from '../services/auth.mjs';
import {
  enrichSubmissionPayload,
  insertPendingSubmissionWithPhotos,
  submissionSchema
} from '../services/submissions.mjs';
import { errorResponse, corsHeaders } from '../services/pagination.mjs';
import { fuzzCoordinates } from '../services/privacy-fuzzing.mjs';

const app = new Router();

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
  const payload = await req.json();

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

  const client = await createDbClient();
  await client.connect();

  try {
    const created = await insertPendingSubmissionWithPhotos(
      client,
      enrichSubmissionPayload(payload, authResult.contributor)
    );

    await enqueuePhotoProcessing(created.claimedPhotoIds);

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
      return {
        statusCode: 502,
        body: {
          error: 'PhotoProcessingQueueError',
          message: 'Submission saved but photo processing queueing failed'
        }
      };
    }

    throw error;
  } finally {
    await client.end();
  }
});


app.get('/okra', async () => {
  const cdnDomain = process.env.MEDIA_CDN_DOMAIN;
  if (!cdnDomain) {
    console.error(JSON.stringify({
      level: 'warn',
      message: 'MEDIA_CDN_DOMAIN not set — photo URLs will be empty',
      endpoint: 'GET /okra'
    }));
  }

  const client = await createDbClient();
  await client.connect();
  try {
    const res = await client.query(
      `SELECT s.id, s.contributor_name, s.story_text, s.privacy_mode,
              s.display_lat, s.display_lng, s.country
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

app.get('/okra/stats', async () => {
  const client = await createDbClient();
  await client.connect();
  try {
    const res = await client.query(
      `SELECT
         COUNT(*)::int AS total_pins,
         COUNT(DISTINCT country)::int AS country_count,
         COUNT(DISTINCT contributor_name) FILTER (WHERE contributor_name IS NOT NULL AND contributor_name <> '')::int AS contributor_count
       FROM submissions
       WHERE status = 'approved'
         AND NOT (display_lat = 0 AND display_lng = 0)`
    );
    const { total_pins, country_count, contributor_count } = res.rows[0];
    return new Response(
      JSON.stringify({ total_pins, country_count, contributor_count }),
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

export const handler = async (event, context) => {
  const response = await app.resolve(event, context);

  // Ensure CORS headers are present on every response, including those
  // built by the Powertools Router from plain-object route returns.
  if (response && typeof response === 'object' && !response.headers?.['access-control-allow-origin']) {
    response.headers = {
      ...response.headers,
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'Content-Type,Authorization,Idempotency-Key,X-Correlation-Id,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
      'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    };
  }

  return response;
};
