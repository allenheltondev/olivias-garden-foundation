import { type FormEvent, useEffect, useState } from 'react';
import { Button, Card, FormFeedback, Input, Select, Textarea } from '@olivias/ui';
import {
  createStoreProduct,
  listSeedRequestQueue,
  listOkraReviewQueue,
  listStoreProducts,
  markSeedRequestHandled,
  reviewOkraSubmission,
  updateStoreProduct,
  type OkraSubmission,
  type SeedRequestQueueItem,
  type StoreProduct,
  type UpsertStoreProductRequest,
} from './api';
import { loadAdminSession, type AdminSession } from './auth/session';

const foundationHomeUrl = import.meta.env.VITE_FOUNDATION_URL
  ? import.meta.env.VITE_FOUNDATION_URL.replace(/\/+$/, '')
  : 'https://oliviasgarden.org';
const foundationLoginUrl = `${foundationHomeUrl}/login`;

const emptyProductForm: UpsertStoreProductRequest = {
  slug: '',
  name: '',
  short_description: '',
  description: '',
  status: 'draft',
  kind: 'donation',
  fulfillment_type: 'none',
  is_public: false,
  is_featured: false,
  currency: 'usd',
  unit_amount_cents: 0,
  statement_descriptor: '',
  nonprofit_program: '',
  impact_summary: '',
  image_url: '',
  metadata: {},
};

const statusOptions = [
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
];

const kindOptions = [
  { value: 'donation', label: 'Donation' },
  { value: 'merchandise', label: 'Merchandise' },
  { value: 'ticket', label: 'Ticket' },
  { value: 'sponsorship', label: 'Sponsorship' },
  { value: 'other', label: 'Other' },
];

const fulfillmentOptions = [
  { value: 'none', label: 'None' },
  { value: 'digital', label: 'Digital' },
  { value: 'shipping', label: 'Shipping' },
  { value: 'pickup', label: 'Pickup' },
];

function redirectToLogin() {
  const returnUrl = window.location.href;
  window.location.assign(`${foundationLoginUrl}?redirect=${encodeURIComponent(returnUrl)}`);
}

export default function App() {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [okraQueue, setOkraQueue] = useState<OkraSubmission[]>([]);
  const [seedRequestQueue, setSeedRequestQueue] = useState<SeedRequestQueueItem[]>([]);
  const [activeProductId, setActiveProductId] = useState<string | null>(null);
  const [productForm, setProductForm] = useState<UpsertStoreProductRequest>(emptyProductForm);
  const [activeTab, setActiveTab] = useState<'moderation' | 'requests' | 'store'>('moderation');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let mounted = true;

    void loadAdminSession().then((nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      setIsLoadingSession(false);
    });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!session?.isAdmin) return;

    void Promise.all([
      listStoreProducts(session.accessToken),
      listOkraReviewQueue(session.accessToken),
      listSeedRequestQueue(session.accessToken),
    ])
      .then(([nextProducts, nextQueue, nextSeedRequests]) => {
        setProducts(nextProducts);
        setOkraQueue(nextQueue);
        setSeedRequestQueue(nextSeedRequests);
      })
      .catch((error: Error) => {
        setLoadError(error.message);
      });
  }, [session]);

  if (isLoadingSession) {
    return <div className="admin-shell"><p>Loading admin session...</p></div>;
  }

  if (!session) {
    redirectToLogin();
    return <div className="admin-shell"><p>Redirecting to login...</p></div>;
  }

  if (!session.isAdmin) {
    return (
      <div className="admin-shell admin-shell--centered">
        <Card className="admin-restricted">
          <p className="admin-eyebrow">Restricted</p>
          <h1>Administrator access is required.</h1>
          <div className="admin-restricted__actions">
            <Button onClick={() => window.location.assign(foundationHomeUrl)}>
              Back to Olivia&apos;s Garden
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const startCreate = () => {
    setActiveProductId(null);
    setProductForm(emptyProductForm);
  };

  const startEdit = (product: StoreProduct) => {
    setActiveProductId(product.id);
    setProductForm({
      slug: product.slug,
      name: product.name,
      short_description: product.short_description,
      description: product.description,
      status: product.status,
      kind: product.kind,
      fulfillment_type: product.fulfillment_type,
      is_public: product.is_public,
      is_featured: product.is_featured,
      currency: product.currency,
      unit_amount_cents: product.unit_amount_cents,
      statement_descriptor: product.statement_descriptor,
      nonprofit_program: product.nonprofit_program,
      impact_summary: product.impact_summary,
      image_url: product.image_url,
      metadata: product.metadata,
    });
    setActiveTab('store');
  };

  const refreshData = async () => {
    const [nextProducts, nextQueue, nextSeedRequests] = await Promise.all([
      listStoreProducts(session.accessToken),
      listOkraReviewQueue(session.accessToken),
      listSeedRequestQueue(session.accessToken),
    ]);
    setProducts(nextProducts);
    setOkraQueue(nextQueue);
    setSeedRequestQueue(nextSeedRequests);
  };

  const submitProduct = async (event: FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setLoadError(null);

    try {
      const payload = {
        ...productForm,
        short_description: productForm.short_description || null,
        description: productForm.description || null,
        statement_descriptor: productForm.statement_descriptor || null,
        nonprofit_program: productForm.nonprofit_program || null,
        impact_summary: productForm.impact_summary || null,
        image_url: productForm.image_url || null,
      };

      if (activeProductId) {
        await updateStoreProduct(session.accessToken, activeProductId, payload);
      } else {
        await createStoreProduct(session.accessToken, payload);
      }

      await refreshData();
      startCreate();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to save store product.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReview = async (
    submission: OkraSubmission,
    action: 'approved' | 'denied'
  ) => {
    try {
      if (action === 'approved') {
        await reviewOkraSubmission(session.accessToken, submission.id, {
          status: 'approved',
        });
      } else {
        await reviewOkraSubmission(session.accessToken, submission.id, {
          status: 'denied',
          reason: 'other',
          review_notes: 'Reviewed in admin dashboard.',
        });
      }
      await refreshData();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to update submission status.');
    }
  };

  const handleSeedRequest = async (request: SeedRequestQueueItem) => {
    try {
      await markSeedRequestHandled(session.accessToken, request.id, {
        status: 'handled',
        review_notes: 'Handled in admin dashboard.',
      });
      await refreshData();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to update seed request status.');
    }
  };

  return (
    <div className="admin-shell">
      <header className="admin-hero">
        <div>
          <p className="admin-eyebrow">Olivia&apos;s Garden Admin</p>
          <h1>Moderation and store operations in one control room.</h1>
          <p className="admin-subtitle">
            Review okra submissions, keep the public map clean, and manage store products backed by Stripe.
          </p>
        </div>
        <div className="admin-pill">{session.email || 'admin account'}</div>
      </header>

      <div className="admin-tabs" role="tablist" aria-label="Admin sections">
        <button
          type="button"
          className={activeTab === 'moderation' ? 'is-active' : ''}
          onClick={() => setActiveTab('moderation')}
        >
          Okra queue
        </button>
        <button
          type="button"
          className={activeTab === 'requests' ? 'is-active' : ''}
          onClick={() => setActiveTab('requests')}
        >
          Seed requests
        </button>
        <button
          type="button"
          className={activeTab === 'store' ? 'is-active' : ''}
          onClick={() => setActiveTab('store')}
        >
          Store catalog
        </button>
      </div>

      {loadError ? <FormFeedback tone="error" className="admin-load-error">{loadError}</FormFeedback> : null}

      {activeTab === 'moderation' ? (
        <section className="admin-grid">
          {okraQueue.length === 0 ? (
            <Card><p>No pending okra submissions.</p></Card>
          ) : (
            okraQueue.map((submission) => (
              <Card key={submission.id} className="admin-card--submission">
                <div className="submission-meta">
                  <div>
                    <h2>{submission.contributor_name || 'Anonymous contributor'}</h2>
                    <p>{submission.contributor_email || 'No email provided'}</p>
                  </div>
                  <span>{new Date(submission.created_at).toLocaleString()}</span>
                </div>
                <p>{submission.story_text || 'No story provided.'}</p>
                <p className="submission-location">{submission.raw_location_text || 'No location text provided.'}</p>
                {submission.photos?.[0] ? (
                  <img className="submission-photo" src={submission.photos[0]} alt="Okra submission" />
                ) : null}
                <div className="submission-actions">
                  <Button onClick={() => void handleReview(submission, 'approved')}>
                    Approve
                  </Button>
                  <Button variant="outline" onClick={() => void handleReview(submission, 'denied')}>
                    Deny
                  </Button>
                </div>
              </Card>
            ))
          )}
        </section>
      ) : activeTab === 'requests' ? (
        <section className="admin-grid">
          {seedRequestQueue.length === 0 ? (
            <Card><p>No open seed requests.</p></Card>
          ) : (
            seedRequestQueue.map((request) => (
              <Card key={request.id} className="admin-card--submission">
                <div className="submission-meta">
                  <div>
                    <h2>{request.name || 'Anonymous requester'}</h2>
                    <p>{request.email || 'No email provided'}</p>
                  </div>
                  <span>{request.createdAt ? new Date(request.createdAt).toLocaleString() : 'Unknown time'}</span>
                </div>
                <p>
                  {request.fulfillmentMethod === 'in_person' ? 'In-person exchange' : 'Mail fulfillment'}
                </p>
                {request.shippingAddress ? (
                  <p className="submission-location">
                    {[
                      request.shippingAddress.line1,
                      request.shippingAddress.line2,
                      request.shippingAddress.city,
                      request.shippingAddress.region,
                      request.shippingAddress.postalCode,
                      request.shippingAddress.country,
                    ].filter(Boolean).join(', ')}
                  </p>
                ) : null}
                {request.visitDetails?.approximateDate ? (
                  <p>Visit timing: {request.visitDetails.approximateDate}</p>
                ) : null}
                {request.visitDetails?.notes ? (
                  <p>{request.visitDetails.notes}</p>
                ) : null}
                {request.message ? <p>{request.message}</p> : null}
                <div className="submission-actions">
                  <Button onClick={() => void handleSeedRequest(request)}>
                    Mark handled
                  </Button>
                </div>
              </Card>
            ))
          )}
        </section>
      ) : (
        <section className="admin-store-layout">
          <Card>
            <div className="store-header">
              <div>
                <p className="admin-eyebrow">Store products</p>
                <h2>Current catalog</h2>
              </div>
              <Button variant="secondary" size="sm" onClick={startCreate}>New product</Button>
            </div>
            <div className="store-list">
              {products.map((product) => (
                <button key={product.id} type="button" className="store-row" onClick={() => startEdit(product)}>
                  <span>
                    <strong>{product.name}</strong>
                    <small>{product.slug}</small>
                  </span>
                  <span>
                    <strong>${(product.unit_amount_cents / 100).toFixed(2)}</strong>
                    <small>{product.status}</small>
                  </span>
                </button>
              ))}
            </div>
          </Card>

          <Card className="store-form-card">
            <form className="store-form" onSubmit={submitProduct}>
              <div className="store-header">
                <div>
                  <p className="admin-eyebrow">{activeProductId ? 'Edit product' : 'Create product'}</p>
                  <h2>{activeProductId ? 'Update store product' : 'Add store product'}</h2>
                </div>
              </div>
              <Input
                label="Name"
                value={productForm.name}
                onChange={(event) => setProductForm((current) => ({ ...current, name: event.target.value }))}
              />
              <Input
                label="Slug"
                value={productForm.slug}
                onChange={(event) => setProductForm((current) => ({ ...current, slug: event.target.value.toLowerCase() }))}
              />
              <Input
                label="Short description"
                value={productForm.short_description || ''}
                onChange={(event) => setProductForm((current) => ({ ...current, short_description: event.target.value }))}
              />
              <Textarea
                label="Description"
                value={productForm.description || ''}
                onChange={(event) => setProductForm((current) => ({ ...current, description: event.target.value }))}
              />
              <div className="store-grid">
                <Select
                  label="Status"
                  value={productForm.status}
                  onChange={(value) => setProductForm((current) => ({ ...current, status: value as StoreProduct['status'] }))}
                  options={statusOptions}
                />
                <Select
                  label="Kind"
                  value={productForm.kind}
                  onChange={(value) => setProductForm((current) => ({ ...current, kind: value as StoreProduct['kind'] }))}
                  options={kindOptions}
                />
                <Select
                  label="Fulfillment"
                  value={productForm.fulfillment_type}
                  onChange={(value) => setProductForm((current) => ({ ...current, fulfillment_type: value as StoreProduct['fulfillment_type'] }))}
                  options={fulfillmentOptions}
                />
                <Input
                  type="number"
                  label="Price (cents)"
                  value={productForm.unit_amount_cents}
                  onChange={(event) => setProductForm((current) => ({ ...current, unit_amount_cents: Number(event.target.value) || 0 }))}
                />
              </div>
              <div className="store-grid">
                <label className="admin-checkbox">
                  <input
                    type="checkbox"
                    checked={productForm.is_public}
                    onChange={(event) => setProductForm((current) => ({ ...current, is_public: event.target.checked }))}
                  />
                  Publicly visible
                </label>
                <label className="admin-checkbox">
                  <input
                    type="checkbox"
                    checked={productForm.is_featured}
                    onChange={(event) => setProductForm((current) => ({ ...current, is_featured: event.target.checked }))}
                  />
                  Featured
                </label>
              </div>
              <Input
                label="Nonprofit program"
                value={productForm.nonprofit_program || ''}
                onChange={(event) => setProductForm((current) => ({ ...current, nonprofit_program: event.target.value }))}
              />
              <Textarea
                label="Impact summary"
                value={productForm.impact_summary || ''}
                onChange={(event) => setProductForm((current) => ({ ...current, impact_summary: event.target.value }))}
              />
              <Input
                type="url"
                label="Image URL"
                value={productForm.image_url || ''}
                onChange={(event) => setProductForm((current) => ({ ...current, image_url: event.target.value }))}
              />
              <div className="store-form__actions">
                <Button type="submit" loading={isSaving} disabled={isSaving}>
                  {isSaving ? 'Saving...' : activeProductId ? 'Update product' : 'Create product'}
                </Button>
              </div>
            </form>
          </Card>
        </section>
      )}
    </div>
  );
}
