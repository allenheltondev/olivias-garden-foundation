/**
 * Report tools (area `reports`): read-only views of how the foundation is
 * doing — the dashboard numbers, the activity feed and revenue.
 */

import { z } from 'zod';
import { READ, guarded } from '../shared.mjs';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}/).describe('A date, YYYY-MM-DD (or a full ISO time).');

export function registerReportTools(r, { backends, logger }) {
  r.register(
    'get_dashboard_stats',
    {
      title: 'Get dashboard stats',
      description: 'The admin dashboard numbers: okra submissions, gardens on the map, seed requests and packets sent.',
      inputSchema: z.object({}),
      annotations: READ
    },
    guarded(async () => backends.request('okra', { path: '/stats' }), logger),
    { backends, services: ['okra'] }
  );

  r.register(
    'list_activity',
    {
      title: 'List recent activity',
      description: 'The activity feed, newest first: donations, orders, sign-ups, seed requests and other events. Page with the returned cursor.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).default(25),
        cursor: z.string().max(2000).optional(),
        detail_type: z.string().max(200).optional().describe('Only one kind of event, by its detail type.')
      }),
      annotations: READ
    },
    guarded(async ({ limit, cursor, detail_type }) =>
      backends.request('admin', { path: '/admin/activity', query: { limit, cursor, detailType: detail_type } }), logger),
    { backends, services: ['admin'] }
  );

  r.register(
    'get_revenue',
    {
      title: 'Get revenue',
      description: 'Donation and store revenue in cents, totalled and bucketed by day, week or month. Defaults to the recent past.',
      inputSchema: z.object({
        from: day.optional(),
        to: day.optional(),
        granularity: z.enum(['day', 'week', 'month']).optional()
      }),
      annotations: READ
    },
    guarded(async ({ from, to, granularity }) =>
      backends.request('admin', { path: '/admin/finance/revenue', query: { from, to, granularity } }), logger),
    { backends, services: ['admin'] }
  );
}
