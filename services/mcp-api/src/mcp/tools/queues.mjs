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
import { READ, WRITE, guarded, uuid } from '../shared.mjs';

const mapLocation = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  precision: z.enum(['city', 'nearby']).optional()
});

const notes = z.string().max(2000).optional().describe('Private note for the record.');

function setSeedRequestStatus(backends, id, body) {
  return backends.request('okra', { method: 'POST', path: `/requests/${id}/statuses`, body });
}

export function registerQueueTools(r, { backends, logger }) {
  const okra = { backends, services: ['okra'] };
  const grn = { backends, services: ['grn'] };

  r.register(
    'whats_pending',
    {
      title: "What's pending",
      description:
        'What needs the operator: open seed requests, okra photos awaiting review, API access requests awaiting a decision. ' +
        'Counts plus the oldest few of each. A service that cannot answer is reported, not fatal.',
      inputSchema: z.object({ preview: z.number().int().min(0).max(20).default(5).describe('Items of each kind to include.') }),
      annotations: READ
    },
    guarded(async ({ preview }) => {
      const take = (items) => (items ?? []).slice(0, preview);
      const checks = {
        seed_requests: backends.has('okra')
          ? backends.request('okra', { path: '/requests', query: { status: 'open', page: 1, limit: Math.max(preview, 1) } })
            .then((o) => ({ open: o.total ?? o.data?.length ?? 0, oldest: take(o.data) }))
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
      description: 'Okra seed requests by status (open = waiting to be sent), oldest first, with name, how they want them (mail or in person), address and notes.',
      inputSchema: z.object({
        status: z.enum(['open', 'handled', 'cancelled']).default('open'),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20)
      }),
      annotations: READ
    },
    guarded(async ({ status, page, limit }) =>
      backends.request('okra', { path: '/requests', query: { status, page, limit } }), logger),
    okra
  );

  r.register(
    'mark_seed_request_done',
    {
      title: 'Mark a seed request done',
      description:
        'Record that the seeds were sent (or handed over). Counts the packet in the impact totals. ' +
        'For a mailed request, map_location (city-level lat/lng) puts a "seeds sent" pin on the public map.',
      inputSchema: z.object({ id: uuid('seed request'), review_notes: notes, map_location: mapLocation.optional() }),
      annotations: WRITE
    },
    guarded(async ({ id, review_notes, map_location }) =>
      setSeedRequestStatus(backends, id, { status: 'handled', review_notes, map_location }), logger),
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
