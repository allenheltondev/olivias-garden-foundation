import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
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
const MIN_PRICE_CENTS = 50;

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
  // time in the input. Submit converts back via new Date(local).
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

function formatStatus(status: WorkshopStatus): string {
  return STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

export function WorkshopsPage({ session }: WorkshopsPageProps) {
  const [workshops, setWorkshops] = useState<AdminWorkshop[]>([]);
  const [signups, setSignups] = useState<AdminWorkshopSignup[]>([]);
  const [signupsWorkshopId, setSignupsWorkshopId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Modal state lives here; opening sets `editingWorkshop` to either an
  // existing workshop (edit) or null (create). The modal component
  // resets its internal form whenever the prop changes.
  const [modalOpen, setModalOpen] = useState(false);
  const [editingWorkshop, setEditingWorkshop] = useState<AdminWorkshop | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await listAdminWorkshops(session.accessToken);
      setWorkshops(next);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load workshops.');
    }
  }, [session.accessToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openCreateModal = () => {
    setEditingWorkshop(null);
    setModalOpen(true);
    setInfo(null);
    setError(null);
  };

  const openEditModal = (workshop: AdminWorkshop) => {
    setEditingWorkshop(workshop);
    setModalOpen(true);
    setInfo(null);
    setError(null);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingWorkshop(null);
  };

  const handleSaved = async (action: 'created' | 'updated', workshop: AdminWorkshop) => {
    setInfo(action === 'created'
      ? `Created "${workshop.title}".`
      : `Updated "${workshop.title}".`);
    closeModal();
    await refresh();
  };

  const handleDeleted = async (workshop: AdminWorkshop) => {
    setInfo(`Deleted "${workshop.title}".`);
    closeModal();
    await refresh();
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

  const signupsWorkshop = signupsWorkshopId
    ? workshops.find((workshop) => workshop.id === signupsWorkshopId) ?? null
    : null;

  return (
    <section className="admin-section">
      <SectionHeading
        eyebrow="Workshops"
        title="Hands-on workshops"
        body="Create, schedule, and manage workshop sessions. Sign-ups happen on the public site."
      />

      {error ? <FormFeedback tone="error" className="admin-load-error">{error}</FormFeedback> : null}
      {info ? <FormFeedback tone="success" className="admin-load-error">{info}</FormFeedback> : null}

      <Card>
        <div className="admin-workshops__list-header">
          <div>
            <p className="og-section-label">Scheduled workshops</p>
            <h3>Catalog</h3>
          </div>
          <Button variant="secondary" size="sm" onClick={openCreateModal}>
            New workshop
          </Button>
        </div>

        <div className="admin-workshops__list">
          {workshops.length === 0 ? (
            <p className="admin-workshops__empty">No workshops yet.</p>
          ) : (
            workshops.map((workshop) => (
              <div
                key={workshop.id}
                className={`admin-workshops__row${workshop.id === signupsWorkshopId ? ' is-active' : ''}`}
              >
                <button
                  type="button"
                  className="admin-workshops__row-body"
                  onClick={() => openEditModal(workshop)}
                >
                  <span className="admin-workshops__row-title">
                    <strong>{workshop.title}</strong>
                    <small>{workshop.slug}</small>
                  </span>
                  <span className="admin-workshops__row-meta">
                    <strong>{formatStatus(workshop.status)}</strong>
                    <small>
                      {formatDate(workshop.workshop_date)}
                      {' · '}
                      {workshop.is_paid
                        ? formatMoney(workshop.price_cents, workshop.currency)
                        : 'Free'}
                    </small>
                  </span>
                  <span className="admin-workshops__row-counts">
                    <strong>
                      R {workshop.signup_counts.registered}
                      {' · '}W {workshop.signup_counts.waitlisted}
                      {' · '}I {workshop.signup_counts.interested}
                    </strong>
                    <small>signups</small>
                  </span>
                </button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleViewSignups(workshop.id)}
                >
                  Signups
                </Button>
              </div>
            ))
          )}
        </div>
      </Card>

      {signupsWorkshopId && signupsWorkshop ? (
        <Card className="admin-workshops__signups-card">
          <div className="admin-workshops__list-header">
            <div>
              <p className="og-section-label">Signups</p>
              <h3>{signupsWorkshop.title}</h3>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setSignupsWorkshopId(null);
                setSignups([]);
              }}
            >
              Close
            </Button>
          </div>
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
                // Surface them dimmed, but rely on the explicit
                // "Cancelled X — refund pending" copy in the last column
                // to carry the state — not color alone.
                return (
                  <tr
                    key={signup.id}
                    className={isCancelled ? 'admin-workshops__signups-row--cancelled' : undefined}
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

      <WorkshopFormModal
        accessToken={session.accessToken}
        open={modalOpen}
        workshop={editingWorkshop}
        onClose={closeModal}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
      />
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Modal
// ─────────────────────────────────────────────────────────────────────

interface WorkshopFormModalProps {
  accessToken: string;
  open: boolean;
  workshop: AdminWorkshop | null;
  onClose: () => void;
  onSaved: (action: 'created' | 'updated', workshop: AdminWorkshop) => void | Promise<void>;
  onDeleted: (workshop: AdminWorkshop) => void | Promise<void>;
}

function workshopToForm(workshop: AdminWorkshop | null): UpsertWorkshopRequest {
  if (!workshop) return emptyForm;
  return {
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
  };
}

function WorkshopFormModal({
  accessToken,
  open,
  workshop,
  onClose,
  onSaved,
  onDeleted,
}: WorkshopFormModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState<UpsertWorkshopRequest>(emptyForm);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // showModal/close on the native <dialog>. Native dialog gives us
  // focus trapping, Esc-to-close, and inert background for free.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Reset form whenever the modal opens for a different workshop (or a
  // fresh "create"). Clearing on close as well so the next open starts
  // from a clean slate when entering create mode after editing.
  useEffect(() => {
    if (!open) return;
    setForm(workshopToForm(workshop));
    setImagePreviewUrl(workshop?.image_url ?? null);
    setPriceInput(
      workshop?.is_paid && workshop.price_cents !== null
        ? (workshop.price_cents / 100).toFixed(2)
        : '',
    );
    setFormError(null);
  }, [open, workshop]);

  const handleImageUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!VALID_IMAGE_TYPES.includes(file.type)) {
      setFormError('Image must be a JPEG, PNG, or WebP.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setFormError(`Image must be ${MAX_IMAGE_BYTES / 1024 / 1024} MB or smaller.`);
      return;
    }
    setUploading(true);
    setFormError(null);
    try {
      const result = await uploadWorkshopImage(accessToken, file);
      setForm((current) => ({ ...current, image_s3_key: result.s3Key }));
      setImagePreviewUrl(URL.createObjectURL(file));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to upload image.');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      let payload: UpsertWorkshopRequest = form;
      if (form.is_paid) {
        const dollars = Number.parseFloat(priceInput);
        if (!Number.isFinite(dollars) || dollars <= 0) {
          throw new Error('Enter a price greater than zero for paid workshops.');
        }
        const priceCents = Math.round(dollars * 100);
        if (priceCents < MIN_PRICE_CENTS) {
          throw new Error(`Minimum price is $${(MIN_PRICE_CENTS / 100).toFixed(2)}.`);
        }
        payload = { ...form, price_cents: priceCents };
      } else {
        payload = { ...form, price_cents: null };
      }

      if (workshop) {
        const updated = await updateWorkshop(accessToken, workshop.id, payload);
        await onSaved('updated', updated);
      } else {
        const created = await createWorkshop(accessToken, payload);
        await onSaved('created', created);
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to save workshop.');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!workshop) return;
    if (!window.confirm('Delete this workshop? Its signups will also be deleted.')) {
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await deleteWorkshop(accessToken, workshop.id);
      await onDeleted(workshop);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to delete workshop.');
    } finally {
      setBusy(false);
    }
  };

  // Native dialogs fire `cancel` on Esc and `close` when .close() is
  // called. We listen for both so React state stays in sync with the
  // dialog's open state. Without this, hitting Esc closes the dialog
  // visually but the parent thinks it's still open.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => onClose();
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [onClose]);

  // Backdrop-click to dismiss: native dialog backdrop is the dialog
  // element itself when the click target is outside the inner container.
  const handleBackdropClick = (event: React.MouseEvent<HTMLDialogElement>) => {
    if (event.target === dialogRef.current) {
      onClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="admin-workshops__modal"
      onClick={handleBackdropClick}
    >
      <div className="admin-workshops__modal-body">
        <div className="admin-workshops__modal-header">
          <h2>{workshop ? 'Edit workshop' : 'Create workshop'}</h2>
          <button
            type="button"
            className="admin-workshops__modal-close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="admin-form admin-workshops__form">
          <Input
            label="Title"
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
            required
          />
          <Input
            label="Slug"
            value={form.slug}
            onChange={(event) => setForm({ ...form, slug: event.target.value.toLowerCase() })}
            placeholder="spring-garden-prep"
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
            variants — datetime-local isn't allowed. FormField keeps
            the same label chrome around a native input.
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
            onChange={(event) => setForm({ ...form, location: event.target.value || null })}
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
                    price_cents: nextIsPaid ? form.price_cents : null,
                  });
                  if (!nextIsPaid) setPriceInput('');
                }}
              />
              <span>This is a paid workshop</span>
            </label>
            {form.is_paid ? (
              <div className="admin-workshops__paid-fields">
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
                  onChange={(value) => setForm({ ...form, currency: value.toLowerCase() })}
                  options={[{ value: 'usd', label: 'USD' }]}
                />
                <p className="admin-workshops__paid-meta">
                  Attendees pay this amount when they register.
                </p>
              </div>
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

          <FormField label="Cover image">
            <div className="admin-workshops__file-upload">
              {imagePreviewUrl ? (
                <img
                  src={imagePreviewUrl}
                  alt=""
                  className="admin-workshops__file-preview"
                />
              ) : null}
              <div className="admin-workshops__file-controls">
                {/*
                  Visually-hidden native file input layered under a
                  styled label. Clicking the label triggers the input
                  via the implicit label association, and the label
                  itself is the focus target.
                */}
                <label className="admin-workshops__file-button">
                  <span>{form.image_s3_key ? 'Replace image' : 'Choose image'}</span>
                  <input
                    type="file"
                    accept={VALID_IMAGE_TYPES.join(',')}
                    onChange={handleImageUpload}
                    disabled={uploading}
                    className="admin-workshops__file-input"
                  />
                </label>
                {form.image_s3_key ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setForm({ ...form, image_s3_key: null });
                      setImagePreviewUrl(null);
                    }}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
              <small className="admin-workshops__file-hint">
                JPEG, PNG, or WebP. Up to {MAX_IMAGE_BYTES / 1024 / 1024} MB.
              </small>
            </div>
          </FormField>

          {formError ? <FormFeedback tone="error">{formError}</FormFeedback> : null}

          <div className="admin-workshops__modal-actions">
            {workshop ? (
              <Button
                type="button"
                variant="secondary"
                onClick={handleDelete}
                disabled={busy}
                className="admin-workshops__modal-actions-delete"
              >
                Delete
              </Button>
            ) : null}
            <div className="admin-workshops__modal-actions-primary">
              <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || uploading}>
                {busy ? 'Saving…' : workshop ? 'Save changes' : 'Create workshop'}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </dialog>
  );
}
