import { type ChangeEvent, type FormEvent, useEffect, useState } from 'react';
import {
  Button,
  Card,
  FormFeedback,
  FormField,
  Input,
  SectionHeading,
  Select,
  Textarea,
} from '@olivias/ui';
import {
  type AdminWorkshop,
  type AdminWorkshopSignup,
  type UpsertWorkshopRequest,
  type WorkshopStatus,
  createWorkshop,
  deleteWorkshop,
  listAdminWorkshopSignups,
  listAdminWorkshops,
  updateWorkshop,
  uploadWorkshopImage,
} from '../api';
import type { AdminSession } from '../auth/session';

export interface WorkshopsPageProps {
  session: AdminSession;
}

const STATUS_OPTIONS: Array<{ value: WorkshopStatus; label: string }> = [
  { value: 'coming_soon', label: 'Coming soon' },
  { value: 'gauging_interest', label: 'Gauging interest' },
  { value: 'open', label: 'Open for signups' },
  { value: 'closed', label: 'Closed (waitlist only)' },
  { value: 'past', label: 'Past' },
];

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const VALID_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const emptyForm: UpsertWorkshopRequest = {
  slug: '',
  title: '',
  short_description: null,
  description: null,
  status: 'coming_soon',
  workshop_date: null,
  location: null,
  capacity: null,
  image_s3_key: null,
  is_paid: false,
  price_cents: null,
  currency: 'usd',
};

const MIN_PRICE_CENTS = 50;

function formatMoney(amountCents: number | null, currency: string | null): string {
  if (amountCents === null) return '—';
  const dollars = amountCents / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: (currency || 'usd').toUpperCase(),
      maximumFractionDigits: dollars % 1 === 0 ? 0 : 2,
    }).format(dollars);
  } catch {
    return `$${dollars.toFixed(2)}`;
  }
}

function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  // toISOString → UTC. Strip the trailing 'Z' to render as the admin's local
  // time in the input. Submit handler converts back via new Date(local).
  const offsetMs = date.getTime() - date.getTimezoneOffset() * 60_000;
  return new Date(offsetMs).toISOString().slice(0, 16);
}

function fromDatetimeLocalValue(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function formatSignupKind(kind: AdminWorkshopSignup['kind']): string {
  switch (kind) {
    case 'registered': return 'Registered';
    case 'waitlisted': return 'Waitlist';
    case 'interested': return 'Interested';
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

export function WorkshopsPage({ session }: WorkshopsPageProps) {
  const [workshops, setWorkshops] = useState<AdminWorkshop[]>([]);
  const [activeWorkshopId, setActiveWorkshopId] = useState<string | null>(null);
  const [form, setForm] = useState<UpsertWorkshopRequest>(emptyForm);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [signups, setSignups] = useState<AdminWorkshopSignup[]>([]);
  const [signupsWorkshopId, setSignupsWorkshopId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Tracked separately from form.price_cents so admins can type "1.5" without
  // the input snapping to "1.50" mid-keystroke; mirrors StorePage.tsx.
  const [priceInput, setPriceInput] = useState('');

  const refresh = async () => {
    try {
      const next = await listAdminWorkshops(session.accessToken);
      setWorkshops(next);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load workshops.');
    }
  };

  // refresh is defined inline above and closes over session.accessToken,
  // which is the only thing it actually uses. The repo's eslint config
  // doesn't include react-hooks/exhaustive-deps, so we skip the
  // suppression comment that StorePage doesn't use either.
  useEffect(() => {
    void refresh();
  }, [session.accessToken]);

  const startCreate = () => {
    setActiveWorkshopId(null);
    setForm(emptyForm);
    setPriceInput('');
    setImagePreviewUrl(null);
    setSignups([]);
    setSignupsWorkshopId(null);
    setError(null);
    setInfo(null);
  };

  const startEdit = (workshop: AdminWorkshop) => {
    setActiveWorkshopId(workshop.id);
    setForm({
      slug: workshop.slug,
      title: workshop.title,
      short_description: workshop.short_description,
      description: workshop.description,
      status: workshop.status,
      workshop_date: workshop.workshop_date,
      location: workshop.location,
      capacity: workshop.capacity,
      image_s3_key: workshop.image_s3_key,
      is_paid: workshop.is_paid,
      price_cents: workshop.price_cents,
      currency: workshop.currency,
    });
    setPriceInput(
      workshop.is_paid && workshop.price_cents !== null
        ? (workshop.price_cents / 100).toFixed(2)
        : '',
    );
    setImagePreviewUrl(workshop.image_url);
    setSignups([]);
    setSignupsWorkshopId(null);
    setError(null);
    setInfo(null);
  };

  const handleImageUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!VALID_IMAGE_TYPES.includes(file.type)) {
      setError('Image must be a JPEG, PNG, or WebP.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(`Image must be ${MAX_IMAGE_BYTES / 1024 / 1024} MB or smaller.`);
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const result = await uploadWorkshopImage(session.accessToken, file);
      setForm((current) => ({ ...current, image_s3_key: result.s3Key }));
      setImagePreviewUrl(URL.createObjectURL(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to upload image.');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      // priceInput is the source of truth for the visible field; convert to
      // cents (rounded, since dollar inputs may have float precision noise)
      // right before submit so the server gets an integer.
      let payload: UpsertWorkshopRequest = form;
      if (form.is_paid) {
        const dollars = Number.parseFloat(priceInput);
        if (!Number.isFinite(dollars) || dollars <= 0) {
          throw new Error('Enter a price greater than zero for paid workshops.');
        }
        const priceCents = Math.round(dollars * 100);
        if (priceCents < MIN_PRICE_CENTS) {
          throw new Error(`Stripe requires a minimum price of $${(MIN_PRICE_CENTS / 100).toFixed(2)}.`);
        }
        payload = { ...form, price_cents: priceCents };
      } else {
        payload = { ...form, price_cents: null };
      }

      if (activeWorkshopId) {
        const updated = await updateWorkshop(session.accessToken, activeWorkshopId, payload);
        setForm({
          ...payload,
          is_paid: updated.is_paid,
          price_cents: updated.price_cents,
          currency: updated.currency,
        });
        setInfo(`Updated "${updated.title}".`);
      } else {
        const created = await createWorkshop(session.accessToken, payload);
        setActiveWorkshopId(created.id);
        setForm({
          ...payload,
          is_paid: created.is_paid,
          price_cents: created.price_cents,
          currency: created.currency,
        });
        setInfo(`Created "${created.title}".`);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save workshop.');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!activeWorkshopId) return;
    if (!window.confirm('Delete this workshop? Its signups will also be deleted.')) {
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await deleteWorkshop(session.accessToken, activeWorkshopId);
      setInfo('Workshop deleted.');
      startCreate();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete workshop.');
    } finally {
      setBusy(false);
    }
  };

  const handleViewSignups = async (workshopId: string) => {
    setSignupsWorkshopId(workshopId);
    setError(null);
    try {
      const next = await listAdminWorkshopSignups(session.accessToken, workshopId);
      setSignups(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load signups.');
    }
  };

  return (
    <div className="admin-page admin-workshops">
      <SectionHeading title="Workshops" />

      <div className="admin-grid">
        <Card title="Workshops" className="admin-workshops__list">
          <Button onClick={startCreate} variant="secondary">+ New workshop</Button>
          <ul className="admin-workshops__list-items">
            {workshops.map((workshop) => (
              <li
                key={workshop.id}
                className={`admin-workshops__list-item${workshop.id === activeWorkshopId ? ' is-active' : ''}`}
              >
                <button
                  type="button"
                  className="admin-workshops__list-row"
                  onClick={() => startEdit(workshop)}
                >
                  <span className="admin-workshops__list-title">{workshop.title}</span>
                  <span className="admin-workshops__list-meta">
                    {workshop.status} · {formatDate(workshop.workshop_date)}
                    {workshop.is_paid
                      ? ` · ${formatMoney(workshop.price_cents, workshop.currency)}`
                      : ' · free'}
                  </span>
                  <span className="admin-workshops__list-counts">
                    R: {workshop.signup_counts.registered}
                    {' · '}W: {workshop.signup_counts.waitlisted}
                    {' · '}I: {workshop.signup_counts.interested}
                  </span>
                </button>
                <Button
                  variant="secondary"
                  onClick={() => handleViewSignups(workshop.id)}
                >
                  Signups
                </Button>
              </li>
            ))}
            {workshops.length === 0 ? <li>No workshops yet.</li> : null}
          </ul>
        </Card>

        <Card
          title={activeWorkshopId ? 'Edit workshop' : 'Create workshop'}
          className="admin-workshops__form"
        >
          <form onSubmit={handleSubmit} className="admin-form">
            <Input
              label="Slug"
              value={form.slug}
              onChange={(event) => setForm({ ...form, slug: event.target.value })}
              placeholder="spring-garden-prep"
              required
            />
            <Input
              label="Title"
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              required
            />
            <Select
              label="Status"
              value={form.status}
              onChange={(value) => setForm({ ...form, status: value as WorkshopStatus })}
              options={STATUS_OPTIONS}
            />
            {/*
              The shared Input component restricts `type` to text-like
              variants — it doesn't allow datetime-local. We use a native
              input wrapped in FormField for the same label/error chrome.
            */}
            <FormField label="Workshop date and time" htmlFor="workshop-date-input">
              <input
                id="workshop-date-input"
                type="datetime-local"
                className="og-input__field"
                value={toDatetimeLocalValue(form.workshop_date)}
                onChange={(event) =>
                  setForm({ ...form, workshop_date: fromDatetimeLocalValue(event.target.value) })
                }
              />
            </FormField>
            <Input
              label="Location"
              value={form.location ?? ''}
              onChange={(event) =>
                setForm({ ...form, location: event.target.value || null })
              }
              placeholder="Olivia's Garden, McKinney TX"
            />
            <Input
              label="Capacity (leave blank for unlimited)"
              type="number"
              min={0}
              value={form.capacity === null ? '' : String(form.capacity)}
              onChange={(event) => {
                const raw = event.target.value;
                setForm({
                  ...form,
                  capacity: raw === '' ? null : Math.max(0, Number.parseInt(raw, 10) || 0),
                });
              }}
            />

            <div className="admin-workshops__paid">
              <label className="admin-workshops__paid-toggle">
                <input
                  type="checkbox"
                  checked={form.is_paid}
                  onChange={(event) => {
                    const nextIsPaid = event.target.checked;
                    setForm({
                      ...form,
                      is_paid: nextIsPaid,
                      // Reset price when toggling off; keep price when toggling on
                      // (the user can fill it in below).
                      price_cents: nextIsPaid ? form.price_cents : null,
                    });
                    if (!nextIsPaid) setPriceInput('');
                  }}
                />
                <span>This is a paid workshop (creates a Stripe product)</span>
              </label>
              {form.is_paid ? (
                <>
                  <Input
                    label="Price (in dollars)"
                    type="number"
                    min={MIN_PRICE_CENTS / 100}
                    step="0.01"
                    value={priceInput}
                    onChange={(event) => setPriceInput(event.target.value)}
                    placeholder="25.00"
                    required
                  />
                  <Select
                    label="Currency"
                    value={form.currency}
                    onChange={(value) =>
                      setForm({ ...form, currency: value.toLowerCase() })
                    }
                    options={[{ value: 'usd', label: 'USD' }]}
                  />
                  {activeWorkshopId ? (
                    <p className="admin-workshops__paid-meta">
                      Stripe price IDs rotate when amount or currency changes; the
                      product (and its history) is preserved.
                    </p>
                  ) : (
                    <p className="admin-workshops__paid-meta">
                      A Stripe Product + Price will be created when you save.
                    </p>
                  )}
                </>
              ) : null}
            </div>

            <Textarea
              label="Short description"
              value={form.short_description ?? ''}
              onChange={(event) =>
                setForm({ ...form, short_description: event.target.value || null })
              }
              rows={2}
            />
            <Textarea
              label="Full description"
              value={form.description ?? ''}
              onChange={(event) =>
                setForm({ ...form, description: event.target.value || null })
              }
              rows={6}
            />

            <div className="admin-workshops__image">
              {imagePreviewUrl ? (
                <img src={imagePreviewUrl} alt="" className="admin-workshops__image-preview" />
              ) : null}
              <label className="admin-workshops__image-input">
                <span>Cover image (JPEG/PNG/WebP, ≤ 5 MB)</span>
                <input
                  type="file"
                  accept={VALID_IMAGE_TYPES.join(',')}
                  onChange={handleImageUpload}
                  disabled={uploading}
                />
              </label>
              {form.image_s3_key ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setForm({ ...form, image_s3_key: null });
                    setImagePreviewUrl(null);
                  }}
                >
                  Remove image
                </Button>
              ) : null}
            </div>

            {error ? <FormFeedback tone="error">{error}</FormFeedback> : null}
            {info ? <FormFeedback tone="success">{info}</FormFeedback> : null}

            <div className="admin-form__actions">
              <Button type="submit" disabled={busy || uploading}>
                {busy ? 'Saving…' : activeWorkshopId ? 'Save changes' : 'Create workshop'}
              </Button>
              {activeWorkshopId ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleDelete}
                  disabled={busy}
                >
                  Delete
                </Button>
              ) : null}
            </div>
          </form>
        </Card>

        {signupsWorkshopId ? (
          <Card title="Signups" className="admin-workshops__signups">
            <p className="admin-workshops__signups-meta">
              {signups.length} {signups.length === 1 ? 'signup' : 'signups'} for this workshop.
            </p>
            <table className="admin-workshops__signups-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Payment</th>
                  <th>Amount</th>
                  <th>Signed up at</th>
                  <th>Cancelled</th>
                </tr>
              </thead>
              <tbody>
                {signups.map((signup) => {
                  const isCancelled = signup.cancelled_at !== null;
                  // Cancelled paid rows are the audit trail for "user paid
                  // and asked to cancel — admin still needs to refund."
                  // Surface them dimmed but with all the detail (amount,
                  // session id) the admin needs to issue the refund.
                  return (
                    <tr
                      key={signup.id}
                      className={isCancelled ? 'admin-workshops__signups-row--cancelled' : undefined}
                      // Slightly dimmed so cancelled rows aren't visually
                      // dominant. The explicit "Cancelled X — refund
                      // pending" copy in the last column is what carries
                      // the state — we don't rely on color alone.
                      style={isCancelled ? { opacity: 0.7 } : undefined}
                    >
                      <td>{signup.user_name ?? '—'}</td>
                      <td>{signup.user_email ?? '—'}</td>
                      <td>{formatSignupKind(signup.kind)}</td>
                      <td>
                        {signup.payment_status === 'not_required'
                          ? '—'
                          : signup.payment_status === 'paid'
                          ? `Paid ${signup.paid_at ? `(${formatDate(signup.paid_at)})` : ''}`.trim()
                          : signup.payment_status === 'pending'
                          ? 'Pending'
                          : 'Refunded'}
                      </td>
                      <td>{formatMoney(signup.amount_cents, signup.currency)}</td>
                      <td>{formatDate(signup.created_at)}</td>
                      <td>
                        {isCancelled
                          ? signup.payment_status === 'paid'
                            ? `Cancelled ${formatDate(signup.cancelled_at)} — refund pending`
                            : `Cancelled ${formatDate(signup.cancelled_at)}`
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
                {signups.length === 0 ? (
                  <tr><td colSpan={7}>No signups yet.</td></tr>
                ) : null}
              </tbody>
            </table>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
