import { type ChangeEvent, type FormEvent, type KeyboardEvent, useEffect, useState } from 'react';
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
  archiveStoreProduct,
  createStoreProduct,
  listStoreProducts,
  uploadStoreProductImage,
  updateStoreProduct,
  type ProductVariation,
  type StoreProduct,
  type StoreProductImage,
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
  variations: [],
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

const MAX_PRODUCT_IMAGES = 8;
const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;

type ProductImageFormItem = Pick<
  StoreProductImage,
  | 'id'
  | 'status'
  | 'url'
  | 'thumbnail_url'
  | 'sort_order'
  | 'alt_text'
  | 'variation_match'
  | 'processing_error'
> & {
  localPreviewUrl?: string;
};

export function StorePage({ session }: StorePageProps) {
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [activeProductId, setActiveProductId] = useState<string | null>(null);
  const [productForm, setProductForm] = useState<UpsertStoreProductRequest>(emptyProductForm);
  const [productImages, setProductImages] = useState<ProductImageFormItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
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

  useEffect(() => {
    if (!activeProductId || !productImages.some((image) => image.status === 'processing')) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      listStoreProducts(session.accessToken)
        .then((next) => {
          setProducts(next);
          const activeProduct = next.find((product) => product.id === activeProductId);
          if (activeProduct) {
            setProductImages((current) =>
              activeProduct.images.map((image) => {
                // Preserve unsaved variation_match edits while polling for
                // processing status updates from the server.
                const local = current.find((item) => item.id === image.id);
                return {
                  id: image.id,
                  status: image.status,
                  url: image.url,
                  thumbnail_url: image.thumbnail_url,
                  sort_order: image.sort_order,
                  alt_text: image.alt_text,
                  variation_match: local?.variation_match ?? image.variation_match ?? {},
                  processing_error: image.processing_error,
                };
              })
            );
          }
        })
        .catch((err: Error) => setError(err.message || 'Unable to refresh product images.'));
    }, 5000);

    return () => window.clearInterval(timer);
  }, [activeProductId, productImages, session.accessToken]);

  const startCreate = () => {
    setActiveProductId(null);
    setProductForm(emptyProductForm);
    setProductImages([]);
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
      image_url: product.legacy_image_url,
      metadata: product.metadata,
      variations: product.variations.map((variation) => ({
        name: variation.name,
        values: [...variation.values],
      })),
    });
    setProductImages(
      product.images.map((image) => ({
        id: image.id,
        status: image.status,
        url: image.url,
        thumbnail_url: image.thumbnail_url,
        sort_order: image.sort_order,
        alt_text: image.alt_text,
        variation_match: image.variation_match ?? {},
        processing_error: image.processing_error,
      }))
    );
  };

  const uploadImages = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;

    setIsUploadingImages(true);
    setError(null);

    try {
      if (productImages.length + files.length > MAX_PRODUCT_IMAGES) {
        throw new Error(`Products can have up to ${MAX_PRODUCT_IMAGES} uploaded images.`);
      }
      for (const file of files) {
        if (file.size > MAX_PRODUCT_IMAGE_BYTES) {
          throw new Error('Product images must be 5 MB or smaller.');
        }
        const localPreviewUrl = URL.createObjectURL(file);
        const uploaded = await uploadStoreProductImage(session.accessToken, file);
        setProductImages((current) => [
          ...current,
          {
            id: uploaded.imageId,
            status: uploaded.status,
            url: null,
            thumbnail_url: null,
            sort_order: current.length,
            alt_text: '',
            variation_match: {},
            processing_error: null,
            localPreviewUrl,
          },
        ]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to upload product image.');
    } finally {
      setIsUploadingImages(false);
    }
  };

  const removeImage = (imageId: string) => {
    setProductImages((current) => current.filter((image) => image.id !== imageId));
  };

  const variations = productForm.variations ?? [];

  const updateVariations = (next: ProductVariation[]) => {
    setProductForm((current) => ({ ...current, variations: next }));
  };

  const addVariation = () => {
    updateVariations([...variations, { name: '', values: [] }]);
  };

  const removeVariation = (index: number) => {
    updateVariations(variations.filter((_, i) => i !== index));
  };

  const setVariationName = (index: number, name: string) => {
    updateVariations(variations.map((variation, i) => (i === index ? { ...variation, name } : variation)));
  };

  const addVariationValue = (index: number, value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    updateVariations(
      variations.map((variation, i) =>
        i === index && !variation.values.includes(trimmed)
          ? { ...variation, values: [...variation.values, trimmed] }
          : variation
      )
    );
  };

  const removeVariationValue = (index: number, valueIndex: number) => {
    updateVariations(
      variations.map((variation, i) =>
        i === index
          ? { ...variation, values: variation.values.filter((_, vi) => vi !== valueIndex) }
          : variation
      )
    );
  };

  const moveImage = (imageId: string, direction: -1 | 1) => {
    setProductImages((current) => {
      const index = current.findIndex((image) => image.id === imageId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next.map((image, sort_order) => ({ ...image, sort_order }));
    });
  };

  const submitProduct = async (event: FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      const cleanedVariations = (productForm.variations ?? [])
        .map((variation) => ({
          name: variation.name.trim(),
          values: variation.values.map((value) => value.trim()).filter(Boolean),
        }))
        .filter((variation) => variation.name && variation.values.length > 0);

      // Drop any image variation_match entries that no longer line up with
      // the cleaned variation list (e.g. admin removed a value).
      const allowedValues = new Map(
        cleanedVariations.map((variation) => [variation.name, new Set(variation.values)])
      );
      const cleanImageVariationMatch = (match: Record<string, string>): Record<string, string> => {
        const result: Record<string, string> = {};
        for (const [name, value] of Object.entries(match)) {
          if (allowedValues.get(name)?.has(value)) {
            result[name] = value;
          }
        }
        return result;
      };

      const payload: UpsertStoreProductRequest = {
        ...productForm,
        short_description: productForm.short_description || null,
        description: productForm.description || null,
        statement_descriptor: productForm.statement_descriptor || null,
        nonprofit_program: productForm.nonprofit_program || null,
        impact_summary: productForm.impact_summary || null,
        image_url: productForm.image_url || null,
        images: productImages.map((image, index) => ({
          id: image.id,
          sort_order: index,
          alt_text: image.alt_text || null,
          variation_match: cleanImageVariationMatch(image.variation_match ?? {}),
        })),
        variations: cleanedVariations,
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

  const archiveProduct = async () => {
    if (!activeProductId) return;
    setIsArchiving(true);
    setError(null);
    try {
      await archiveStoreProduct(session.accessToken, activeProductId);
      const next = await listStoreProducts(session.accessToken);
      setProducts(next);
      startCreate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to archive store product.');
    } finally {
      setIsArchiving(false);
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
              label="Fallback image URL"
              value={productForm.image_url || ''}
              onChange={(event) => setProductForm((current) => ({ ...current, image_url: event.target.value }))}
            />
            <VariationsEditor
              variations={variations}
              onAdd={addVariation}
              onRemove={removeVariation}
              onNameChange={setVariationName}
              onAddValue={addVariationValue}
              onRemoveValue={removeVariationValue}
            />
            <div className="admin-store-images">
              <div className="admin-store-images__header">
                <div>
                  <p className="og-section-label">Product images</p>
                  <h4>Uploaded images</h4>
                </div>
                <label className="admin-store-images__upload">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    onChange={uploadImages}
                    disabled={isUploadingImages || isSaving}
                  />
                  {isUploadingImages ? 'Uploading...' : 'Upload images'}
                </label>
              </div>
              {productImages.length === 0 ? (
                <p className="admin-store-images__empty">No uploaded images yet.</p>
              ) : (
                <div className="admin-store-images__grid">
                  {productImages.map((image) => (
                    <div className="admin-store-images__item" key={image.id}>
                      {image.thumbnail_url || image.url || image.localPreviewUrl ? (
                        <img
                          src={image.thumbnail_url || image.url || image.localPreviewUrl}
                          alt={image.alt_text || ''}
                        />
                      ) : (
                        <div className="admin-store-images__placeholder" />
                      )}
                      <div className="admin-store-images__meta">
                        <small>{image.status}</small>
                        {image.processing_error ? <small>{image.processing_error}</small> : null}
                      </div>
                      <Input
                        label="Alt text"
                        value={image.alt_text || ''}
                        onChange={(event) =>
                          setProductImages((current) =>
                            current.map((item) =>
                              item.id === image.id ? { ...item, alt_text: event.target.value } : item
                            )
                          )
                        }
                      />
                      {variations.length > 0 ? (
                        <div className="admin-store-images__variation-match">
                          <p className="og-section-label">Show for</p>
                          {variations.map((variation) =>
                            variation.name && variation.values.length > 0 ? (
                              <Select
                                key={variation.name}
                                label={variation.name}
                                value={image.variation_match[variation.name] ?? ''}
                                onChange={(value) =>
                                  setProductImages((current) =>
                                    current.map((item) => {
                                      if (item.id !== image.id) return item;
                                      const next = { ...item.variation_match };
                                      if (value) next[variation.name] = value;
                                      else delete next[variation.name];
                                      return { ...item, variation_match: next };
                                    })
                                  )
                                }
                                options={[
                                  { value: '', label: 'Any' },
                                  ...variation.values.map((value) => ({ value, label: value })),
                                ]}
                              />
                            ) : null
                          )}
                        </div>
                      ) : null}
                      <div className="admin-store-images__actions">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => moveImage(image.id, -1)}
                          disabled={productImages[0]?.id === image.id}
                        >
                          Up
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => moveImage(image.id, 1)}
                          disabled={productImages[productImages.length - 1]?.id === image.id}
                        >
                          Down
                        </Button>
                        <Button type="button" variant="secondary" size="sm" onClick={() => removeImage(image.id)}>
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="admin-store-form__actions">
              {activeProductId ? (
                <Button type="button" variant="secondary" loading={isArchiving} disabled={isSaving || isArchiving} onClick={archiveProduct}>
                  Archive product
                </Button>
              ) : null}
              <Button type="submit" loading={isSaving} disabled={isSaving || isUploadingImages}>
                {isSaving ? 'Saving…' : activeProductId ? 'Update product' : 'Create product'}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </section>
  );
}

interface VariationsEditorProps {
  variations: ProductVariation[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onNameChange: (index: number, name: string) => void;
  onAddValue: (index: number, value: string) => void;
  onRemoveValue: (index: number, valueIndex: number) => void;
}

function VariationsEditor({
  variations,
  onAdd,
  onRemove,
  onNameChange,
  onAddValue,
  onRemoveValue,
}: VariationsEditorProps) {
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  const submitValue = (index: number) => {
    const draft = drafts[index];
    if (!draft) return;
    onAddValue(index, draft);
    setDrafts((current) => ({ ...current, [index]: '' }));
  };

  const handleValueKey = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      submitValue(index);
    }
  };

  return (
    <div className="admin-store-variations">
      <div className="admin-store-variations__header">
        <div>
          <p className="og-section-label">Variations (optional)</p>
          <h4>Customer-selectable options</h4>
          <small>e.g. Color: Red, Blue · Ink: Black, White. Each option requires a name and at least one value.</small>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={onAdd}>
          Add variation
        </Button>
      </div>
      {variations.length === 0 ? (
        <p className="admin-store-variations__empty">No variations. Customers buy a single SKU.</p>
      ) : (
        <ul className="admin-store-variations__list">
          {variations.map((variation, index) => (
            <li key={index} className="admin-store-variations__item">
              <div className="admin-store-variations__row">
                <Input
                  label="Option name"
                  placeholder="Color"
                  value={variation.name}
                  onChange={(event) => onNameChange(index, event.target.value)}
                />
                <Button type="button" variant="secondary" size="sm" onClick={() => onRemove(index)}>
                  Remove
                </Button>
              </div>
              <div className="admin-store-variations__values">
                {variation.values.map((value, valueIndex) => (
                  <span key={valueIndex} className="admin-store-variations__chip">
                    {value}
                    <button
                      type="button"
                      aria-label={`Remove ${value}`}
                      onClick={() => onRemoveValue(index, valueIndex)}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="admin-store-variations__row">
                <Input
                  label="Add value"
                  placeholder="Red"
                  value={drafts[index] ?? ''}
                  onChange={(event) =>
                    setDrafts((current) => ({ ...current, [index]: event.target.value }))
                  }
                  onKeyDown={(event) => handleValueKey(event, index)}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => submitValue(index)}
                  disabled={!drafts[index]?.trim()}
                >
                  Add value
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
