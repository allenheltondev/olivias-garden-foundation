/**
 * Workshop tools (area `workshops`), on the admin API
 * (services/admin-api/src/services/workshops.mjs).
 */

import { z } from 'zod';
import { DESTRUCTIVE, READ, WRITE, ToolError, defined, guarded, uuid } from '../shared.mjs';

const STATUSES = ['coming_soon', 'gauging_interest', 'open', 'closed', 'past'];

const workshopFields = {
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).describe('URL slug, lowercase kebab-case.'),
  title: z.string().min(1).max(200),
  status: z.enum(STATUSES).describe('coming_soon, gauging_interest (collect interest), open (sign-ups), closed, past.'),
  workshop_date: z.iso.datetime({ offset: true }).nullish().describe('Start time, ISO 8601 with offset, e.g. 2027-04-12T10:00:00-05:00.'),
  location: z.string().max(500).nullish(),
  capacity: z.number().int().min(0).nullish().describe('Seats; null for no limit.'),
  short_description: z.string().max(500).nullish(),
  description: z.string().max(10_000).nullish(),
  image_s3_key: z.string().max(300).nullish().describe('The s3Key from request_workshop_image_upload.'),
  is_paid: z.boolean().describe('Paid workshops get a Stripe price.'),
  price_cents: z.number().int().min(50).nullish().describe('Required when is_paid: 2500 is $25.00.'),
  currency: z.string().regex(/^[a-z]{3}$/).optional()
};

function writablePayload(workshop) {
  return {
    slug: workshop.slug,
    title: workshop.title,
    status: workshop.status,
    workshop_date: workshop.workshop_date ?? null,
    location: workshop.location ?? null,
    capacity: workshop.capacity ?? null,
    short_description: workshop.short_description ?? null,
    description: workshop.description ?? null,
    image_s3_key: workshop.image_s3_key ?? null,
    is_paid: Boolean(workshop.is_paid),
    price_cents: workshop.price_cents ?? null,
    currency: workshop.currency ?? 'usd'
  };
}

export function mergeWorkshopUpdate(current, changes) {
  return { ...writablePayload(current), ...defined(changes) };
}

function summarize(w) {
  return {
    id: w.id,
    slug: w.slug,
    title: w.title,
    status: w.status,
    workshop_date: w.workshop_date,
    location: w.location,
    capacity: w.capacity,
    is_paid: w.is_paid,
    price_cents: w.price_cents,
    signup_counts: w.signup_counts
  };
}

export function registerWorkshopTools(r, { backends, logger }) {
  const admin = { backends, services: ['admin'] };
  const getWorkshop = (id) => backends.request('admin', { path: `/admin/workshops/${id}` });

  r.register(
    'list_workshops',
    {
      title: 'List workshops',
      description: 'Every workshop with its status, date and sign-up counts (registered, waitlisted, interested).',
      inputSchema: z.object({ status: z.enum(STATUSES).optional() }),
      annotations: READ
    },
    guarded(async ({ status }) => {
      const out = await backends.request('admin', { path: '/admin/workshops' });
      const items = (out.items ?? []).filter((w) => !status || w.status === status).map(summarize);
      return { count: items.length, items };
    }, logger),
    admin
  );

  r.register(
    'get_workshop',
    {
      title: 'Get a workshop',
      description: 'One workshop in full.',
      inputSchema: z.object({ id: uuid('workshop') }),
      annotations: READ
    },
    guarded(async ({ id }) => ({ workshop: await getWorkshop(id) }), logger),
    admin
  );

  r.register(
    'list_workshop_signups',
    {
      title: 'List workshop sign-ups',
      description: 'Who signed up for a workshop: name, email, kind (registered, waitlisted, interested), payment status.',
      inputSchema: z.object({ id: uuid('workshop') }),
      annotations: READ
    },
    guarded(async ({ id }) => backends.request('admin', { path: `/admin/workshops/${id}/signups` }), logger),
    admin
  );

  r.register(
    'create_workshop',
    {
      title: 'Create a workshop',
      description: 'Add a workshop. Paid ones are created in Stripe too.',
      inputSchema: z.object({
        ...workshopFields,
        status: workshopFields.status.default('coming_soon'),
        is_paid: workshopFields.is_paid.default(false)
      }),
      annotations: WRITE
    },
    guarded(async (fields) => ({
      workshop: await backends.request('admin', { method: 'POST', path: '/admin/workshops', body: fields })
    }), logger),
    admin
  );

  r.register(
    'update_workshop',
    {
      title: 'Update a workshop',
      description: 'Change some of a workshop\'s fields; anything not given stays as it is. Use status to open sign-ups, close them, or mark it past.',
      inputSchema: z.object({
        id: uuid('workshop'),
        ...Object.fromEntries(Object.entries(workshopFields).map(([k, v]) => [k, v.optional()]))
      }),
      annotations: WRITE
    },
    guarded(async ({ id, ...changes }) => {
      const current = await getWorkshop(id);
      const workshop = await backends.request('admin', {
        method: 'PUT',
        path: `/admin/workshops/${id}`,
        body: mergeWorkshopUpdate(current, changes)
      });
      return { workshop };
    }, logger),
    admin
  );

  r.register(
    'delete_workshop',
    {
      title: 'Delete a workshop',
      description:
        'Permanently delete a workshop (a paid one\'s Stripe product is archived). Cannot be undone. ' +
        'To keep its history, prefer update_workshop with status "closed" or "past". Pass the workshop\'s slug to confirm.',
      inputSchema: z.object({
        id: uuid('workshop'),
        confirm_slug: z.string().describe('The workshop\'s slug, as a check that this is the right one.')
      }),
      annotations: DESTRUCTIVE
    },
    guarded(async ({ id, confirm_slug }) => {
      const current = await getWorkshop(id);
      if (current.slug !== confirm_slug) {
        throw new ToolError(`Not deleted: workshop ${id} is "${current.slug}", not "${confirm_slug}".`);
      }
      return backends.request('admin', { method: 'DELETE', path: `/admin/workshops/${id}` });
    }, logger),
    admin
  );

  r.register(
    'request_workshop_image_upload',
    {
      title: 'Get a workshop image upload URL',
      description: 'A presigned URL to PUT a cover image to (valid 15 minutes, max 5 MB). After uploading, set the returned s3Key as image_s3_key.',
      inputSchema: z.object({
        content_type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
        content_length: z.number().int().min(1).max(5 * 1024 * 1024)
      }),
      annotations: WRITE
    },
    guarded(async ({ content_type, content_length }) =>
      backends.request('admin', {
        method: 'POST',
        path: '/admin/workshops/image-upload-intent',
        body: { contentType: content_type, contentLength: content_length }
      }), logger),
    admin
  );
}
