import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { createDbClient } from '../../scripts/db-client.mjs';
import { isUuid } from '../services/photos.mjs';
import { encodeCursor, decodeCursor, errorResponse } from '../services/pagination.mjs';
import { resolveCountry } from '../services/reverse-geocoder.mjs';
import { getAdminStats } from '../services/admin-stats.mjs';

const s3 = new S3Client({});
const eventBridge = new EventBridgeClient({});
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export async function presignPhotoUrl(bucket, key, expiresIn = 900) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
}

const VALID_STATUSES = ['pending_review', 'approved', 'denied'];
const VALID_ACTIONS = ['approved', 'denied'];
const VALID_DENIAL_REASONS = ['spam', 'invalid_location', 'inappropriate', 'other'];
const VALID_REQUEST_ACTIONS = ['handled'];

function getSeedRequestsTableName() {
  const tableName = process.env.SEED_REQUESTS_TABLE_NAME;
  if (!tableName) {
    throw new Error('SEED_REQUESTS_TABLE_NAME is not configured');
  }
  return tableName;
}

async function listOpenSeedRequests() {
  const result = await dynamo.send(new ScanCommand({
    TableName: getSeedRequestsTableName(),
    FilterExpression: 'attribute_exists(createdAt) AND (attribute_not_exists(#status) OR #status = :open)',
    ExpressionAttributeNames: {
      '#status': 'requestStatus',
    },
    ExpressionAttributeValues: {
      ':open': 'open',
    },
  }));

  return (result.Items ?? [])
    .filter((item) => {
      const requestId = String(item.requestId ?? '');
      return requestId !== 'stats#seed-requests' && !requestId.startsWith('ratelimit#');
    })
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
    .map((item) => ({
      id: item.requestId,
      name: item.name ?? null,
      email: item.email ?? null,
      fulfillmentMethod: item.fulfillmentMethod ?? null,
      shippingAddress: item.shippingAddress ?? null,
      visitDetails: item.visitDetails ?? null,
      message: item.message ?? null,
      createdAt: item.createdAt ?? null,
      requestStatus: item.requestStatus ?? 'open',
    }));
}

async function markSeedRequestHandled(requestId, cognitoSub, reviewNotes) {
  const result = await dynamo.send(new UpdateCommand({
    TableName: getSeedRequestsTableName(),
    Key: { requestId },
    UpdateExpression: 'SET #status = :handled, #handledAt = :handledAt, #handledBy = :handledBy, #notes = :notes',
    ConditionExpression: 'attribute_exists(requestId) AND attribute_exists(createdAt) AND (attribute_not_exists(#status) OR #status = :open)',
    ExpressionAttributeNames: {
      '#status': 'requestStatus',
      '#handledAt': 'handledAt',
      '#handledBy': 'handledByCognitoSub',
      '#notes': 'reviewNotes',
    },
    ExpressionAttributeValues: {
      ':handled': 'handled',
      ':handledAt': new Date().toISOString(),
      ':handledBy': cognitoSub,
      ':notes': reviewNotes ?? null,
      ':open': 'open',
    },
    ReturnValues: 'ALL_NEW',
  }));

  return result.Attributes ?? null;
}

/**
 * Validate and parse the `limit` query parameter (regex-based).
 * Returns { valid: true, value: number } or { valid: false, response: Response }.
 */
function validateLimit(raw) {
  if (raw == null) return { valid: true, value: 20 };
  const trimmed = String(raw).trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    return { valid: false, response: errorResponse(400, 'INVALID_LIMIT', 'Limit must be a positive integer') };
  }
  const parsed = parseInt(trimmed, 10);
  if (parsed === 0) {
    return { valid: false, response: errorResponse(400, 'INVALID_LIMIT', 'Limit must be a positive integer') };
  }
  return { valid: true, value: Math.min(parsed, 100) };
}

/**
 * Validate and decode the `cursor` query parameter.
 * Returns { valid: true, value: object|null } or { valid: false, response: Response }.
 */
function validateCursor(raw) {
  if (raw == null) return { valid: true, value: null };
  const decoded = decodeCursor(raw);
  if (!decoded) {
    return { valid: false, response: errorResponse(400, 'INVALID_CURSOR', 'Invalid or malformed cursor') };
  }
  return { valid: true, value: decoded };
}

export function registerAdminRoutes(app) {
  app.get('/requests/review-queue', async () => {
    try {
      return {
        data: await listOpenSeedRequests(),
      };
    } catch (err) {
      console.error(JSON.stringify({
        level: 'error',
        message: err instanceof Error ? err.message : String(err),
        errorName: err instanceof Error ? err.name : 'UnknownError',
        endpoint: 'GET /admin/requests/review-queue',
      }));
      return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
    }
  });

  app.post('/requests/:id/statuses', async (ctx) => {
    const requestId = ctx.params.id;
    const body = JSON.parse(ctx.event.body || '{}');
    const { status, review_notes } = body;

    if (!status || !VALID_REQUEST_ACTIONS.includes(status)) {
      return errorResponse(400, 'INVALID_ACTION', 'status must be one of: handled');
    }

    const cognitoSub = ctx.event.requestContext?.authorizer?.sub;
    if (!cognitoSub) {
      return errorResponse(403, 'FORBIDDEN', 'Admin user not found');
    }

    try {
      const updated = await markSeedRequestHandled(requestId, cognitoSub, review_notes);
      if (!updated) {
        return errorResponse(404, 'NOT_FOUND', 'Seed request not found');
      }

      return {
        id: updated.requestId,
        requestStatus: updated.requestStatus,
        handledAt: updated.handledAt,
        handledByCognitoSub: updated.handledByCognitoSub,
        reviewNotes: updated.reviewNotes ?? null,
      };
    } catch (err) {
      if (err?.name === 'ConditionalCheckFailedException') {
        return errorResponse(409, 'INVALID_STATE', 'Seed request is already handled or missing');
      }

      console.error(JSON.stringify({
        level: 'error',
        message: err instanceof Error ? err.message : String(err),
        errorName: err instanceof Error ? err.name : 'UnknownError',
        endpoint: 'POST /admin/requests/:id/statuses',
        requestId,
      }));
      return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
    }
  });

  // ─── GET /submissions/review-queue ──────────────────────────────
  app.get('/submissions/review-queue', async (ctx) => {
    const bucket = process.env.MEDIA_BUCKET_NAME;
    if (!bucket) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'MEDIA_BUCKET_NAME not set — cannot generate pre-signed URLs',
        endpoint: 'GET /admin/submissions/review-queue'
      }));
      return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
    }

    const params = ctx.event?.queryStringParameters || {};

    const limitResult = validateLimit(params.limit);
    if (!limitResult.valid) return limitResult.response;
    const limit = limitResult.value;

    const cursorResult = validateCursor(params.cursor);
    if (!cursorResult.valid) return cursorResult.response;
    const cursor = cursorResult.value;

    const client = await createDbClient();
    await client.connect();
    try {
      let rows;
      if (cursor) {
        const res = await client.query(
          `SELECT s.id, s.contributor_name, s.contributor_email, s.story_text,
                  s.raw_location_text, s.privacy_mode, s.display_lat, s.display_lng,
                  s.status, s.created_at,
                  s.created_at::text AS created_at_raw
           FROM submissions s
           WHERE s.status = 'pending_review'
             AND EXISTS (
               SELECT 1 FROM submission_photos sp
               WHERE sp.submission_id = s.id AND sp.status = 'ready'
             )
             AND (s.created_at, s.id) > ($1::timestamptz, $2)
           ORDER BY s.created_at ASC, s.id ASC
           LIMIT $3`,
          [cursor.created_at, cursor.id, limit + 1]
        );
        rows = res.rows;
      } else {
        const res = await client.query(
          `SELECT s.id, s.contributor_name, s.contributor_email, s.story_text,
                  s.raw_location_text, s.privacy_mode, s.display_lat, s.display_lng,
                  s.status, s.created_at,
                  s.created_at::text AS created_at_raw
           FROM submissions s
           WHERE s.status = 'pending_review'
             AND EXISTS (
               SELECT 1 FROM submission_photos sp
               WHERE sp.submission_id = s.id AND sp.status = 'ready'
             )
           ORDER BY s.created_at ASC, s.id ASC
           LIMIT $1`,
          [limit + 1]
        );
        rows = res.rows;
      }

      let nextCursor = null;
      if (rows.length > limit) {
        rows.pop();
        nextCursor = encodeCursor(rows[rows.length - 1]);
      }

      // Batch-fetch photos for all returned submissions
      const submissionIds = rows.map(r => r.id);
      const photoMap = {};
      if (submissionIds.length > 0) {
        const photoRes = await client.query(
          `SELECT submission_id, original_s3_key
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
          photoMap[photo.submission_id].push(photo.original_s3_key);
        }
      }

      // Generate pre-signed S3 URLs for each submission's photos
      const data = await Promise.all(
        rows.map(async (row) => {
          const keys = photoMap[row.id] || [];
          const photos = await Promise.all(
            keys.map((key) => presignPhotoUrl(bucket, key, 900))
          );
          return {
            id: row.id,
            contributor_name: row.contributor_name,
            contributor_email: row.contributor_email,
            story_text: row.story_text,
            raw_location_text: row.raw_location_text,
            privacy_mode: row.privacy_mode,
            display_lat: row.display_lat,
            display_lng: row.display_lng,
            status: row.status,
            created_at: row.created_at,
            photo_count: photos.length,
            has_photos: photos.length > 0,
            photos
          };
        })
      );

      return { data, cursor: nextCursor };
    } catch (err) {
      console.error(JSON.stringify({
        level: 'error',
        message: err instanceof Error ? err.message : String(err),
        errorName: err instanceof Error ? err.name : 'UnknownError',
        endpoint: 'GET /admin/submissions/review-queue'
      }));
      return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
    } finally {
      await client.end();
    }
  });

  // ─── GET /submissions ───────────────────────────────────────────
  app.get('/submissions', async (ctx) => {
    const params = ctx.event.queryStringParameters || {};
    const status = params.status || 'pending_review';
    if (!VALID_STATUSES.includes(status)) {
      return errorResponse(400, 'INVALID_STATUS', `Invalid status: ${status}. Must be one of: ${VALID_STATUSES.join(', ')}`);
    }

    const limitResult = validateLimit(params.limit);
    if (!limitResult.valid) return limitResult.response;
    const limit = limitResult.value;

    const cursorResult = validateCursor(params.cursor);
    if (!cursorResult.valid) return cursorResult.response;
    const cursor = cursorResult.value;

    const client = await createDbClient();
    await client.connect();
    try {
      let queryText;
      let queryParams;
      if (cursor) {
        queryText = `
          SELECT s.id, s.contributor_name, s.story_text, s.raw_location_text,
                 s.privacy_mode, s.display_lat, s.display_lng, s.status, s.created_at,
                 s.created_at::text AS created_at_raw
          FROM submissions s
          WHERE s.status = $1 AND (s.created_at, s.id) > ($2::timestamptz, $3)
          ORDER BY s.created_at ASC, s.id ASC
          LIMIT $4
        `;
        queryParams = [status, cursor.created_at, cursor.id, limit + 1];
      } else {
        queryText = `
          SELECT s.id, s.contributor_name, s.story_text, s.raw_location_text,
                 s.privacy_mode, s.display_lat, s.display_lng, s.status, s.created_at,
                 s.created_at::text AS created_at_raw
          FROM submissions s
          WHERE s.status = $1
          ORDER BY s.created_at ASC, s.id ASC
          LIMIT $2
        `;
        queryParams = [status, limit + 1];
      }

      const submissionsResult = await client.query(queryText, queryParams);
      const rows = submissionsResult.rows;

      let nextCursor = null;
      if (rows.length > limit) {
        rows.pop();
        const lastRow = rows[rows.length - 1];
        nextCursor = encodeCursor(lastRow);
      }

      if (rows.length === 0) {
        return { data: [], cursor: null };
      }

      const submissionIds = rows.map((r) => r.id);
      const photosResult = await client.query(
        `SELECT submission_id, original_s3_key
         FROM submission_photos
         WHERE submission_id = ANY($1)
         ORDER BY submission_id, created_at ASC`,
        [submissionIds]
      );

      const photosBySubmission = {};
      for (const photo of photosResult.rows) {
        if (!photosBySubmission[photo.submission_id]) {
          photosBySubmission[photo.submission_id] = [];
        }
        photosBySubmission[photo.submission_id].push(photo.original_s3_key);
      }

      const bucket = process.env.MEDIA_BUCKET_NAME;
      const data = await Promise.all(
        rows.map(async (row) => {
          const keys = photosBySubmission[row.id] || [];
          const photos = await Promise.all(keys.map((key) => presignPhotoUrl(bucket, key)));
          return {
            id: row.id, contributor_name: row.contributor_name,
            story_text: row.story_text, raw_location_text: row.raw_location_text,
            privacy_mode: row.privacy_mode, display_lat: row.display_lat,
            display_lng: row.display_lng, status: row.status,
            created_at: row.created_at, photo_count: photos.length,
            has_photos: photos.length > 0, photos
          };
        })
      );

      return { data, cursor: nextCursor };
    } catch (err) {
      console.error(JSON.stringify({
        level: 'error',
        message: err instanceof Error ? err.message : String(err),
        errorName: err instanceof Error ? err.name : 'UnknownError',
        endpoint: 'GET /admin/submissions'
      }));
      return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
    } finally {
      await client.end();
    }
  });

  // ─── POST /submissions/:id/statuses ─────────────────────────────
  app.post('/submissions/:id/statuses', async (ctx) => {
    const submissionId = ctx.params.id;

    if (!isUuid(submissionId)) {
      return errorResponse(400, 'INVALID_ID', 'Submission ID must be a valid UUID');
    }

    const body = JSON.parse(ctx.event.body || '{}');
    const { status, review_notes, display_lat, display_lng, reason } = body;

    // Validate status field
    if (!status || !VALID_ACTIONS.includes(status)) {
      return errorResponse(400, 'INVALID_ACTION', 'status must be one of: approved, denied');
    }

    if (status === 'approved') {
      return handleApproval(ctx, submissionId, { review_notes, display_lat, display_lng });
    }

    return handleDenial(ctx, submissionId, { reason, review_notes });
  });

  // ─── GET /stats ────────────────────────────────────────────────
  app.get('/stats', async () => {
    try {
      const stats = await getAdminStats();
      return stats;
    } catch (err) {
      console.error(JSON.stringify({
        level: 'error',
        message: err instanceof Error ? err.message : String(err),
        errorName: err instanceof Error ? err.name : 'UnknownError',
        endpoint: 'GET /admin/stats'
      }));
      return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
    }
  });
}

async function handleApproval(ctx, submissionId, { review_notes, display_lat, display_lng }) {
  const hasLat = display_lat !== undefined && display_lat !== null;
  const hasLng = display_lng !== undefined && display_lng !== null;
  if (hasLat !== hasLng) {
    return errorResponse(400, 'INVALID_COORDINATES', 'Both display_lat and display_lng must be provided together');
  }
  if (hasLat && hasLng) {
    if (typeof display_lat !== 'number' || typeof display_lng !== 'number' ||
        display_lat < -90 || display_lat > 90 || display_lng < -180 || display_lng > 180) {
      return errorResponse(400, 'INVALID_COORDINATES', 'display_lat must be between -90 and 90, display_lng must be between -180 and 180');
    }
  }

  const client = await createDbClient();
  await client.connect();
  try {
    // Verify submission exists and is pending before anything else
    const existsResult = await client.query(
      'SELECT id, status FROM submissions WHERE id = $1', [submissionId]
    );
    if (existsResult.rows.length === 0) {
      return errorResponse(404, 'NOT_FOUND', 'Submission not found');
    }
    if (existsResult.rows[0].status !== 'pending_review') {
      return errorResponse(409, 'INVALID_STATE', `Submission is already ${existsResult.rows[0].status}`);
    }

    const photoCountResult = await client.query(
      'SELECT COUNT(*)::int AS count FROM submission_photos WHERE submission_id = $1',
      [submissionId]
    );
    if (photoCountResult.rows[0].count === 0) {
      return errorResponse(400, 'MISSING_PHOTOS', 'At least one photo is required for approval');
    }

    const cognitoSub = ctx.event.requestContext?.authorizer?.sub || 'system';
    const adminResult = await client.query(
      'SELECT id FROM admin_users WHERE cognito_sub = $1', [cognitoSub]
    );
    const adminUserId = adminResult.rows.length > 0 ? adminResult.rows[0].id : null;
    if (!adminUserId) {
      return errorResponse(403, 'FORBIDDEN', 'Admin user not found');
    }

    await client.query('BEGIN');

    let updateText;
    let updateParams;
    if (hasLat && hasLng) {
      updateText = `UPDATE submissions
        SET status = 'approved', reviewed_by = $2, reviewed_at = now(),
            review_notes = $3, display_lat = $4, display_lng = $5
        WHERE id = $1 AND status = 'pending_review' RETURNING *`;
      updateParams = [submissionId, adminUserId, review_notes || null, display_lat, display_lng];
    } else {
      updateText = `UPDATE submissions
        SET status = 'approved', reviewed_by = $2, reviewed_at = now(),
            review_notes = $3
        WHERE id = $1 AND status = 'pending_review' RETURNING *`;
      updateParams = [submissionId, adminUserId, review_notes || null];
    }

    const updateResult = await client.query(updateText, updateParams);
    if (updateResult.rowCount === 0) {
      // Race condition: status changed between our check and the update
      await client.query('ROLLBACK');
      return errorResponse(409, 'INVALID_STATE', 'Submission status changed during processing');
    }

    const row = updateResult.rows[0];
    await client.query(
      `INSERT INTO submission_reviews (submission_id, action, reviewed_by, reviewed_at, notes)
       VALUES ($1, 'approved', $2, now(), $3)`,
      [submissionId, adminUserId, review_notes || null]
    );

    // Resolve country from coordinates and store in the same transaction
    let country = null;
    try {
      country = resolveCountry(row.display_lat, row.display_lng);
      if (country === null) {
        console.warn(JSON.stringify({
          level: 'warn',
          message: 'Reverse geocoder returned null for coordinates',
          display_lat: row.display_lat,
          display_lng: row.display_lng,
          submissionId
        }));
      }
    } catch (geocodeErr) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'Reverse geocoder threw an error',
        error: geocodeErr instanceof Error ? geocodeErr.message : String(geocodeErr),
        submissionId
      }));
      // country remains null — approval still succeeds
    }
    await client.query(
      'UPDATE submissions SET country = $1 WHERE id = $2',
      [country, submissionId]
    );

    await client.query('COMMIT');

    const response = {
      id: row.id, contributor_name: row.contributor_name,
      story_text: row.story_text, raw_location_text: row.raw_location_text,
      privacy_mode: row.privacy_mode, display_lat: row.display_lat,
      display_lng: row.display_lng, status: row.status,
      reviewed_by: row.reviewed_by, reviewed_at: row.reviewed_at,
      review_notes: row.review_notes, created_at: row.created_at
    };
    if (row.display_lat === 0 && row.display_lng === 0) {
      response.warnings = [{ code: 'SUSPICIOUS_COORDINATES', message: 'Coordinates are at 0,0 -- verify location is correct' }];
    }
    return response;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(JSON.stringify({
      level: 'error',
      message: err instanceof Error ? err.message : String(err),
      errorName: err instanceof Error ? err.name : 'UnknownError',
      endpoint: 'POST /admin/submissions/:id/statuses', submissionId
    }));
    return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  } finally {
    await client.end();
  }
}

async function handleDenial(ctx, submissionId, { reason, review_notes }) {
  if (!reason || !VALID_DENIAL_REASONS.includes(reason)) {
    return errorResponse(400, 'INVALID_REASON', `Invalid reason. Must be one of: ${VALID_DENIAL_REASONS.join(', ')}`);
  }
  if (reason === 'other' && (!review_notes || review_notes.trim() === '')) {
    return errorResponse(400, 'MISSING_NOTES', 'review_notes is required when reason is "other"');
  }

  const client = await createDbClient();
  await client.connect();
  try {
    const cognitoSub = ctx.event.requestContext?.authorizer?.sub || 'system';
    const adminResult = await client.query(
      'SELECT id FROM admin_users WHERE cognito_sub = $1', [cognitoSub]
    );
    const adminUserId = adminResult.rows.length > 0 ? adminResult.rows[0].id : null;
    if (!adminUserId) {
      return errorResponse(403, 'FORBIDDEN', 'Admin user not found');
    }

    await client.query('BEGIN');

    const updateResult = await client.query(
      `UPDATE submissions
       SET status = 'denied', reviewed_by = $2, reviewed_at = now(), review_notes = $3
       WHERE id = $1 AND status = 'pending_review' RETURNING *`,
      [submissionId, adminUserId, review_notes || null]
    );

    if (updateResult.rowCount === 0) {
      const existsResult = await client.query(
        'SELECT id, status FROM submissions WHERE id = $1', [submissionId]
      );
      await client.query('ROLLBACK');
      if (existsResult.rows.length === 0) {
        return errorResponse(404, 'NOT_FOUND', 'Submission not found');
      }
      return errorResponse(409, 'INVALID_STATE', `Submission is already ${existsResult.rows[0].status}`);
    }

    const row = updateResult.rows[0];
    await client.query(
      `INSERT INTO submission_reviews (submission_id, action, reason, reviewed_by, reviewed_at, notes)
       VALUES ($1, 'denied', $2, $3, now(), $4)`,
      [submissionId, reason, adminUserId, review_notes || null]
    );
    await client.query('COMMIT');

    try {
      await eventBridge.send(new PutEventsCommand({
        Entries: [{
          Source: 'okra.api',
          DetailType: 'SubmissionDenied',
          Detail: JSON.stringify({ submissionId })
        }]
      }));
    } catch (ebErr) {
      console.error(JSON.stringify({
        level: 'warn',
        message: 'Failed to publish cleanup event',
        submissionId,
        error: ebErr instanceof Error ? ebErr.message : String(ebErr)
      }));
    }

    return {
      id: row.id, contributor_name: row.contributor_name,
      story_text: row.story_text, raw_location_text: row.raw_location_text,
      privacy_mode: row.privacy_mode, display_lat: row.display_lat,
      display_lng: row.display_lng, status: row.status,
      reviewed_by: row.reviewed_by, reviewed_at: row.reviewed_at,
      review_notes: row.review_notes, created_at: row.created_at
    };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(JSON.stringify({
      level: 'error',
      message: err instanceof Error ? err.message : String(err),
      errorName: err instanceof Error ? err.name : 'UnknownError',
      endpoint: 'POST /admin/submissions/:id/statuses', submissionId
    }));
    return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  } finally {
    await client.end();
  }
}
