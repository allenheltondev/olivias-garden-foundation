import { errorResponse } from '../services/pagination.mjs';
import { parseMapLocation } from '../services/seed-shipment-pins.mjs';
import {
  SEED_REQUEST_STATUSES,
  addSeedRequestMapPin,
  SeedRequestTransitionError,
  attachMapPins,
  cancelSeedRequest,
  listSeedRequests,
  markSeedRequestHandled,
  removeSeedRequestMapPin,
  reopenSeedRequest,
} from '../services/seed-request-admin.mjs';

const TRANSITION_TARGETS = ['handled', 'cancelled', 'open'];

function logError(err, endpoint, extra = {}) {
  console.error(JSON.stringify({
    level: 'error',
    message: err instanceof Error ? err.message : String(err),
    errorName: err instanceof Error ? err.name : 'UnknownError',
    endpoint,
    ...extra,
  }));
}

function parseReviewNotes(raw) {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string' || raw.length > 1000) {
    return { ok: false, message: 'review_notes must be a string of at most 1000 characters' };
  }
  const trimmed = raw.trim();
  return { ok: true, value: trimmed || null };
}

export function registerSeedRequestAdminRoutes(app, { validateLimit, validatePage }) {
  app.get('/requests', async (ctx) => {
    const params = ctx.event?.queryStringParameters || {};
    const status = params.status;

    if (!status || !SEED_REQUEST_STATUSES.includes(status)) {
      return errorResponse(
        400,
        'INVALID_STATUS',
        `status query parameter is required. Must be one of: ${SEED_REQUEST_STATUSES.join(', ')}`
      );
    }

    const limitResult = validateLimit(params.limit);
    if (!limitResult.valid) return limitResult.response;
    const limit = limitResult.value;

    const pageResult = validatePage(params.page);
    if (!pageResult.valid) return pageResult.response;
    const page = pageResult.value;

    try {
      const all = await listSeedRequests(status);
      const total = all.length;
      const start = (page - 1) * limit;
      const data = await attachMapPins(all.slice(start, start + limit));
      return { data, total, page, limit };
    } catch (err) {
      logError(err, 'GET /admin/requests');
      return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
    }
  });

  app.post('/requests/:id/statuses', async (ctx) => {
    const requestId = ctx.params.id;
    let body;
    try {
      body = JSON.parse(ctx.event.body || '{}');
    } catch {
      return errorResponse(400, 'INVALID_BODY', 'Request body must be valid JSON');
    }
    const { status, review_notes, map_location } = body ?? {};

    if (!status || !TRANSITION_TARGETS.includes(status)) {
      return errorResponse(400, 'INVALID_ACTION', `status must be one of: ${TRANSITION_TARGETS.join(', ')}`);
    }

    const notesResult = parseReviewNotes(review_notes);
    if (!notesResult.ok) {
      return errorResponse(400, 'INVALID_REVIEW_NOTES', notesResult.message);
    }

    const mapLocationResult = parseMapLocation(map_location);
    if (!mapLocationResult.ok) {
      return errorResponse(400, 'INVALID_MAP_LOCATION', mapLocationResult.message);
    }

    const cognitoSub = ctx.event.requestContext?.authorizer?.sub;
    if (!cognitoSub) {
      return errorResponse(403, 'FORBIDDEN', 'Admin user not found');
    }

    try {
      if (status === 'handled') {
        return await markSeedRequestHandled(requestId, cognitoSub, notesResult.value, mapLocationResult.value);
      }
      if (status === 'cancelled') {
        return await cancelSeedRequest(requestId, cognitoSub, notesResult.value);
      }
      return await reopenSeedRequest(requestId, cognitoSub, notesResult.value);
    } catch (err) {
      if (err instanceof SeedRequestTransitionError) {
        return err.code === 'NOT_FOUND'
          ? errorResponse(404, 'NOT_FOUND', err.message)
          : errorResponse(409, 'INVALID_STATE', err.message);
      }
      logError(err, 'POST /admin/requests/:id/statuses', { requestId, targetStatus: status });
      return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
    }
  });

  // Put a done request on the public map (e.g. one handled before pins
  // existed). Body: { map_location: { lat, lng } } at city level.
  app.post('/requests/:id/map-pin', async (ctx) => {
    const requestId = ctx.params.id;
    let body;
    try {
      body = JSON.parse(ctx.event.body || '{}');
    } catch {
      return errorResponse(400, 'INVALID_BODY', 'Request body must be valid JSON');
    }
    const mapLocationResult = parseMapLocation(body?.map_location);
    if (!mapLocationResult.ok) {
      return errorResponse(400, 'INVALID_MAP_LOCATION', mapLocationResult.message);
    }
    if (!mapLocationResult.value) {
      return errorResponse(400, 'INVALID_MAP_LOCATION', 'map_location is required');
    }

    try {
      const mapPin = await addSeedRequestMapPin(requestId, mapLocationResult.value);
      return { id: requestId, mapPin };
    } catch (err) {
      if (err instanceof SeedRequestTransitionError) {
        return err.code === 'NOT_FOUND'
          ? errorResponse(404, 'NOT_FOUND', err.message)
          : errorResponse(409, 'INVALID_STATE', err.message);
      }
      logError(err, 'POST /admin/requests/:id/map-pin', { requestId });
      return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
    }
  });

  // Take a request's "seeds sent" pin off the public map without changing the
  // request itself. Idempotent: removing a pin that isn't there is a 200.
  app.delete('/requests/:id/map-pin', async (ctx) => {
    const requestId = ctx.params.id;
    try {
      const removed = await removeSeedRequestMapPin(requestId);
      if (removed === null) {
        return errorResponse(500, 'INTERNAL_ERROR', 'Could not remove the map pin — try again');
      }
      return { id: requestId, mapPinRemoved: removed };
    } catch (err) {
      if (err instanceof SeedRequestTransitionError) {
        return err.code === 'NOT_FOUND'
          ? errorResponse(404, 'NOT_FOUND', err.message)
          : errorResponse(409, 'INVALID_STATE', err.message);
      }
      logError(err, 'DELETE /admin/requests/:id/map-pin', { requestId });
      return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
    }
  });
}
