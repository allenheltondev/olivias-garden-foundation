/**
 * Queue tools (area `queues`): the work that waits on the operator.
 *
 *  - Seed requests (okra admin API): mark done when the packet is sent, cancel,
 *    or reopen.
 *  - Okra photo submissions (okra admin API): approve or deny for the map.
 *  - API access requests (Good Roots Network API): approve or deny.
 *
 * These return what supporters wrote, including names and mailing addresses,
 * which is the point of the queue: the operator needs them to send seeds. The
 * tools are reached only with an operator's own key.
 */

import { z } from 'zod';
import { READ, WRITE, ToolError, guarded, uuid } from '../shared.mjs';
import { wantsMapPin } from '../seed-pins.mjs';

const mapLocation = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  precision: z.enum(['city', 'nearby']).optional()
});

const notes = z.string().max(2000).optional().describe('Private note for the record.');

function setSeedRequestStatus(backends, id, body) {
  return backends.request('okra', { method: 'POST', path: `/requests/${id}/statuses`, body });
}

const OKRA_MAX_LIMIT = 100;

function fetchSeedRequestPage(backends, status, page, limit) {
  return backends.request('okra', { path: '/requests', query: { status, page, limit } });
}

/**
 * One page of seed requests in either order. The okra API sorts newest first
 * (seed-request-admin.mjs, listSeedRequests) and pages that list, so the oldest
 * requests are on its last pages. For `order: 'oldest'` this reads the total,
 * fetches the (at most two) newest-first pages that hold the wanted slice, and
 * reverses it. A request arriving between those reads can shift the slice by
 * one; the next call sees it.
 */
export async function seedRequestPage(backends, { status, page = 1, limit = 20, order = 'newest' }) {
  if (order === 'newest') {
    const out = await fetchSeedRequestPage(backends, status, page, limit);
    return { data: out.data ?? [], total: out.total ?? out.data?.length ?? 0, page, limit, order };
  }
  const head = await fetchSeedRequestPage(backends, status, 1, limit);
  const total = head.total ?? head.data?.length ?? 0;
  // Oldest-first page `page` is newest-first indices [start, end).
  const end = total - (page - 1) * limit;
  const start = Math.max(0, end - limit);
  if (end <= 0) return { data: [], total, page, limit, order };
  const firstPage = Math.floor(start / limit) + 1;
  const lastPage = Math.floor((end - 1) / limit) + 1;
  const pages = [];
  for (let p = firstPage; p <= lastPage; p += 1) {
    pages.push(p === 1 ? head : await fetchSeedRequestPage(backends, status, p, limit));
  }
  const rows = pages.flatMap((out) => out.data ?? []);
  const offset = start - (firstPage - 1) * limit;
  return { data: rows.slice(offset, offset + (end - start)).reverse(), total, page, limit, order };
}

/** A seed request by id, searched in the given statuses (newest first, a hundred at a time). */
async function findSeedRequest(backends, id, statuses) {
  for (const status of statuses) {
    for (let page = 1; ; page += 1) {
      const out = await fetchSeedRequestPage(backends, status, page, OKRA_MAX_LIMIT);
      const found = (out.data ?? []).find((r) => r.id === id);
      if (found) return found;
      if (page * OKRA_MAX_LIMIT >= (out.total ?? 0) || (out.data ?? []).length === 0) break;
    }
  }
  return null;
}

/** What happened to a request's public pin, in words an agent can pass on. */
function pinOutcome(request, mapPin, located) {
  if (mapPin) {
    return { placed: true, pin: mapPin };
  }
  if (request && !wantsMapPin(request)) {
    return {
      placed: false,
      reason: request.fulfillmentMethod === 'mail'
        ? 'No pin: this requester was told they would not get one.'
        : 'No pin: an in-person exchange needs a map address (set it in the admin app) before it can be pinned.'
    };
  }
  return {
    placed: false,
    warning: located === false
      ? "Seeds are recorded as sent, but the requester's city could not be found on the map, so no pin was placed. " +
        'Call add_seed_request_map_pin with a map_location (city-level lat/lng) to add one.'
      : 'Seeds are recorded as sent, but no pin was placed. Call add_seed_request_map_pin to add one.'
  };
}

export function registerQueueTools(r, { backends, logger, locateSeedPin }) {
  const okra = { backends, services: ['okra'] };
  const grn = { backends, services: ['grn'] };

  r.register(
    'whats_pending',
    {
      title: "What's pending",
      description:
        'What needs the operator: open seed requests, okra photos awaiting review, API access requests awaiting a decision. ' +
        'Counts plus the oldest few of each (the ones waiting longest). A service that cannot answer is reported, not fatal.',
      inputSchema: z.object({ preview: z.number().int().min(0).max(20).default(5).describe('Items of each kind to include.') }),
      annotations: READ
    },
    guarded(async ({ preview }) => {
      const take = (items) => (items ?? []).slice(0, preview);
      const checks = {
        // The okra API lists seed requests newest first; okra submissions and
        // API access requests come oldest first already.
        seed_requests: backends.has('okra')
          ? seedRequestPage(backends, { status: 'open', page: 1, limit: Math.max(preview, 1), order: 'oldest' })
            .then((o) => ({ open: o.total, oldest: take(o.data) }))
          : null,
        okra_submissions: backends.has('okra')
          ? backends.request('okra', { path: '/submissions', query: { status: 'pending' } })
            .then((o) => ({ pending: o.total ?? o.data?.length ?? 0, oldest: take(o.data) }))
          : null,
        api_access_requests: backends.has('grn')
          ? backends.request('grn', { path: '/admin/api-access-requests', query: { status: 'pending' } })
            .then((o) => ({ pending: o.total ?? o.items?.length ?? 0, oldest: take(o.items) }))
          : null
      };
      const entries = Object.entries(checks).filter(([, p]) => p);
      const settled = await Promise.allSettled(entries.map(([, p]) => p));
      return Object.fromEntries(entries.map(([name], i) => [
        name,
        settled[i].status === 'fulfilled' ? settled[i].value : { error: settled[i].reason?.message ?? 'unavailable' }
      ]));
    }, logger),
    { backends, services: [] }
  );

  r.register(
    'list_seed_requests',
    {
      title: 'List seed requests',
      description:
        'Okra seed requests by status (open = waiting to be sent), with name, how they want them (mail or in person), ' +
        'address, notes and map pin. Newest first by default; order "oldest" lists the ones waiting longest first.',
      inputSchema: z.object({
        status: z.enum(['open', 'handled', 'cancelled']).default('open'),
        order: z.enum(['newest', 'oldest']).default('newest'),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(OKRA_MAX_LIMIT).default(20)
      }),
      annotations: READ
    },
    guarded(async ({ status, order, page, limit }) => seedRequestPage(backends, { status, order, page, limit }), logger),
    okra
  );

  r.register(
    'mark_seed_request_done',
    {
      title: 'Mark a seed request done',
      description:
        'Record that the seeds were sent (or handed over). Counts the packet in the impact totals and, as the admin app does, ' +
        'puts a "seeds sent" pin on the public map when the requester may have one: their city is looked up (never their street, ' +
        'name or email) unless you pass map_location. The result\'s map_pin says whether a pin was placed; if not, it says why, ' +
        'and add_seed_request_map_pin can add one later.',
      inputSchema: z.object({
        id: uuid('seed request'),
        review_notes: notes,
        map_location: mapLocation.optional().describe('Optional: where to pin it. Omit to look up the requester\'s city.')
      }),
      annotations: WRITE
    },
    guarded(async ({ id, review_notes, map_location }) => {
      let location = map_location;
      let located;
      let request = null;
      if (!location) {
        request = await findSeedRequest(backends, id, ['open']);
        if (request && wantsMapPin(request)) {
          location = (await locateSeedPin(request)) ?? undefined;
          located = Boolean(location);
        }
      }
      const result = await setSeedRequestStatus(backends, id, { status: 'handled', review_notes, map_location: location });
      return { ...result, map_pin: pinOutcome(request, result.mapPin, located) };
    }, logger),
    okra
  );

  r.register(
    'add_seed_request_map_pin',
    {
      title: 'Add a seed request\'s map pin',
      description:
        'Put a done request on the public "seeds sent" map when it has no pin yet: one marked done before pins existed, ' +
        'or one whose city could not be found. Looks up the requester\'s city unless you pass map_location.',
      inputSchema: z.object({
        id: uuid('seed request'),
        map_location: mapLocation.optional().describe('Optional: where to pin it. Omit to look up the requester\'s city.')
      }),
      annotations: WRITE
    },
    guarded(async ({ id, map_location }) => {
      let location = map_location;
      if (!location) {
        const request = await findSeedRequest(backends, id, ['handled']);
        if (!request) throw new ToolError(`No done seed request ${id}. Only a request marked done can be pinned.`);
        if (request.mapPin) return { id, map_pin: { placed: true, pin: request.mapPin, note: 'It already had a pin.' } };
        if (!wantsMapPin(request)) return { id, map_pin: pinOutcome(request, null) };
        location = await locateSeedPin(request);
        if (!location) {
          throw new ToolError(
            "Could not find the requester's city on the map. Pass map_location (city-level lat/lng) to place the pin."
          );
        }
      }
      const result = await backends.request('okra', { method: 'POST', path: `/requests/${id}/map-pin`, body: { map_location: location } });
      if (!result.mapPin) {
        throw new ToolError('The request changed before the pin was added (it may have been reopened). List it again and retry.');
      }
      return { id, map_pin: { placed: true, pin: result.mapPin } };
    }, logger),
    okra
  );

  r.register(
    'cancel_seed_request',
    {
      title: 'Cancel a seed request',
      description: 'Close an open request without sending seeds (spam, duplicate, cannot ship there). Say why in the reason.',
      inputSchema: z.object({ id: uuid('seed request'), reason: notes }),
      annotations: WRITE
    },
    guarded(async ({ id, reason }) =>
      setSeedRequestStatus(backends, id, { status: 'cancelled', review_notes: reason }), logger),
    okra
  );

  r.register(
    'reopen_seed_request',
    {
      title: 'Reopen a seed request',
      description: 'Move a done or cancelled request back to open. Undoing "done" un-counts the packet and removes its map pin.',
      inputSchema: z.object({ id: uuid('seed request'), review_notes: notes }),
      annotations: WRITE
    },
    guarded(async ({ id, review_notes }) =>
      setSeedRequestStatus(backends, id, { status: 'open', review_notes }), logger),
    okra
  );

  r.register(
    'list_okra_submissions',
    {
      title: 'List okra submissions',
      description: 'Okra photo submissions for the map. status "pending" (default) is the review queue: awaiting review with a processed photo.',
      inputSchema: z.object({
        status: z.enum(['pending', 'pending_review', 'approved', 'denied']).default('pending')
      }),
      annotations: READ
    },
    guarded(async ({ status }) => backends.request('okra', { path: '/submissions', query: { status } }), logger),
    okra
  );

  r.register(
    'review_okra_submission',
    {
      title: 'Approve or deny an okra submission',
      description:
        'Approve a submission onto the public map, or deny it with a reason. ' +
        'When it has a pending edit, pass target_edit_id to decide that edit.',
      inputSchema: z.object({
        id: uuid('submission'),
        decision: z.enum(['approved', 'denied']),
        reason: z.enum(['spam', 'invalid_location', 'inappropriate', 'other']).optional().describe('Required to deny.'),
        review_notes: notes,
        target_edit_id: z.uuid().optional()
      }),
      annotations: WRITE
    },
    guarded(async ({ id, decision, reason, review_notes, target_edit_id }) =>
      backends.request('okra', {
        method: 'POST',
        path: `/submissions/${id}/statuses`,
        body: { status: decision, reason, review_notes, target_edit_id }
      }), logger),
    okra
  );

  r.register(
    'list_api_access_requests',
    {
      title: 'List API access requests',
      description: 'Good Roots Network API access requests: who asked, for which integration, and why.',
      inputSchema: z.object({ status: z.enum(['pending', 'approved', 'denied']).default('pending') }),
      annotations: READ
    },
    guarded(async ({ status }) =>
      backends.request('grn', { path: '/admin/api-access-requests', query: { status } }), logger),
    grn
  );

  r.register(
    'decide_api_access_request',
    {
      title: 'Approve or deny an API access request',
      description: 'Approve (grants the grower API access) or deny an API access request, with an optional note the requester sees.',
      inputSchema: z.object({
        id: uuid('API access request'),
        decision: z.enum(['approve', 'deny']),
        note: z.string().max(1000).optional()
      }),
      annotations: WRITE
    },
    guarded(async ({ id, decision, note }) =>
      backends.request('grn', {
        method: 'POST',
        path: `/admin/api-access-requests/${id}/${decision}`,
        body: note?.trim() ? { note: note.trim() } : {}
      }), logger),
    grn
  );
}
