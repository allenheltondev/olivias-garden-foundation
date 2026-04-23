import { type FormEvent, useEffect, useState } from 'react';
import {
  Button,
  Card,
  FormFeedback,
  Input,
  SectionHeading,
  Select,
  Textarea,
} from '@olivias/ui';
import {
  createStoreProduct,
  listStoreProducts,
  updateStoreProduct,
  type StoreProduct,
  type UpsertStoreProductRequest,
} from '../api';
import type { AdminSession } from '../auth/session';

export interface StorePageProps {
  session: AdminSession;
}

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

export function StorePage({ session }: StorePageProps) {
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [activeProductId, setActiveProductId] = useState<string | null>(null);
  const [productForm, setProductForm] = useState<UpsertStoreProductRequest>(emptyProductForm);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listStoreProducts(session.accessToken)
      .then((next) => {
        if (!active) return;
        setProducts(next);
        setError(null);
      })
      .catch((err: Error) => {
        if (!active) return;
        setError(err.message || 'Unable to load store products.');
      });
    return () => {
      active = false;
    };
  }, [session.accessToken]);

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
  };

  const submitProduct = async (event: FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      const payload: UpsertStoreProductRequest = {
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

      const next = await listStoreProducts(session.accessToken);
      setProducts(next);
      startCreate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save store product.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="admin-section">
      <SectionHeading
        eyebrow="Store catalog"
        title="Products backed by Stripe"
        body="Create and edit donation, merchandise, ticket, and sponsorship products."
      />

      {error ? (
        <FormFeedback tone="error" className="admin-load-error">{error}</FormFeedback>
      ) : null}

      <div className="admin-store-layout">
        <Card>
          <div className="admin-store-layout__list-header">
            <div>
              <p className="og-section-label">Store products</p>
              <h3>Current catalog</h3>
            </div>
            <Button variant="secondary" size="sm" onClick={startCreate}>
              New product
            </Button>
          </div>
          <div className="admin-store-list">
            {products.length === 0 ? (
              <p className="admin-store-list__empty">No products yet.</p>
            ) : (
              products.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  className={`admin-store-row ${product.id === activeProductId ? 'is-active' : ''}`.trim()}
                  onClick={() => startEdit(product)}
                >
                  <span>
                    <strong>{product.name}</strong>
                    <small>{product.slug}</small>
                  </span>
                  <span>
                    <strong>${(product.unit_amount_cents / 100).toFixed(2)}</strong>
                    <small>{product.status}</small>
                  </span>
                </button>
              ))
            )}
          </div>
        </Card>

        <Card className="admin-store-form-card">
          <form className="admin-store-form" onSubmit={submitProduct}>
            <div>
              <p className="og-section-label">{activeProductId ? 'Edit product' : 'Create product'}</p>
              <h3>{activeProductId ? 'Update store product' : 'Add store product'}</h3>
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
            <div className="admin-store-grid">
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
            <div className="admin-store-grid">
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
            <div className="admin-store-form__actions">
              <Button type="submit" loading={isSaving} disabled={isSaving}>
                {isSaving ? 'Saving…' : activeProductId ? 'Update product' : 'Create product'}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </section>
  );
}
