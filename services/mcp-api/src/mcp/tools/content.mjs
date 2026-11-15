/**
 * Site content tools (area `content`): the impact metrics and testimonials the
 * public site shows, on the admin API. Each list is saved whole, as the admin
 * app saves it, so the set_* tools replace the list.
 */

import { z } from 'zod';
import { DESTRUCTIVE, READ, guarded } from '../shared.mjs';

const metric = z.object({
  label: z.string().min(1).max(80).describe('e.g. "Seed packets mailed".'),
  value: z.string().min(1).max(40).describe('Shown as written, e.g. "1,200+".'),
  caption: z.string().max(120).nullish()
});

const testimonial = z.object({
  quote: z.string().min(1),
  attribution: z.string().min(1).describe('Who said it.'),
  role: z.string().nullish().describe('e.g. "Workshop attendee".')
});

export function registerContentTools(r, { backends, logger }) {
  const admin = { backends, services: ['admin'] };

  r.register(
    'get_impact_metrics',
    {
      title: 'Get impact metrics',
      description: 'The impact numbers on the site, in display order.',
      inputSchema: z.object({}),
      annotations: READ
    },
    guarded(async () => backends.request('admin', { path: '/admin/impact-metrics' }), logger),
    admin
  );

  r.register(
    'set_impact_metrics',
    {
      title: 'Save impact metrics',
      description:
        'Replace the whole list of impact metrics (at most 24), in display order. Anything not in the list is removed: ' +
        'to change one number, get_impact_metrics first and send the full list back with the change.',
      inputSchema: z.object({ metrics: z.array(metric).max(24) }),
      annotations: DESTRUCTIVE
    },
    guarded(async ({ metrics }) =>
      backends.request('admin', { method: 'PUT', path: '/admin/impact-metrics', body: { metrics } }), logger),
    admin
  );

  r.register(
    'get_testimonials',
    {
      title: 'Get testimonials',
      description: 'The testimonials on the site, in display order.',
      inputSchema: z.object({}),
      annotations: READ
    },
    guarded(async () => backends.request('admin', { path: '/admin/testimonials' }), logger),
    admin
  );

  r.register(
    'set_testimonials',
    {
      title: 'Save testimonials',
      description:
        'Replace the whole list of testimonials, in display order. Anything not in the list is removed: ' +
        'get_testimonials first and send the full list back with your change.',
      inputSchema: z.object({ testimonials: z.array(testimonial) }),
      annotations: DESTRUCTIVE
    },
    guarded(async ({ testimonials }) =>
      backends.request('admin', { method: 'PUT', path: '/admin/testimonials', body: { testimonials } }), logger),
    admin
  );
}
