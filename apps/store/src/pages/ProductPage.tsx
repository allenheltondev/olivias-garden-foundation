import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Button,
  Card,
  FormFeedback,
  isColorVariation,
  resolveColorSwatch,
  EmptyState,
  PageHeading,
} from '@olivias/ui';
import { ProductImage } from '../components/ProductImage';
import { getProductBySlug, type StoreProduct } from '../api';
import { formatMoney, useCart } from '../cart/CartContext';

const KIND_LABEL: Record<StoreProduct['kind'], string> = {
  donation: 'Donation',
  merchandise: 'Merchandise',
  ticket: 'Ticket',
  sponsorship: 'Sponsorship',
  other: 'Other',
};

const FULFILLMENT_LABEL: Record<StoreProduct['fulfillment_type'], string> = {
  none: 'No delivery needed',
  digital: 'Digital delivery',
  shipping: 'Ships to your address',
  pickup: 'Pickup at the garden',
};

export function ProductPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const [product, setProduct] = useState<StoreProduct | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [selectedVariations, setSelectedVariations] = useState<Record<string, string>>({});
  const [variationError, setVariationError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const cart = useCart();
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    setProduct(null);
    setError(null);
    setSelectedVariations({});
    setVariationError(null);
    setQuantity(1);

    getProductBySlug(slug)
      .then((next) => {
        if (!active) return;
        setProduct(next);
        setSelectedImageId(next.images[0]?.id ?? null);
      })
      .catch((err: Error) => {
        if (!active) return;
        setError(err.message || 'Unable to load product.');
      });

    return () => {
      active = false;
    };
  }, [slug, attempt]);

  if (error) {
    return (
      <section className="store-section">
        <Link className="store-back-link" to="/">Back to store</Link>
        <PageHeading title="Product unavailable" />
        <div role="alert"><EmptyState icon="basket" title="We couldn't load this product" actions={(
          <Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>Try again</Button>
        )}><p>It may no longer be available, or the store may be temporarily offline. Try again or browse other products.</p></EmptyState></div>
      </section>
    );
  }
  if (!product) {
    return <p className="store-empty" role="status">Loading product…</p>;
  }
  const onAdd = () => {
    const missing = product.variations
      .filter((variation) => !selectedVariations[variation.name])
      .map((variation) => variation.name);
    if (missing.length > 0) {
      setVariationError(`Please choose a ${missing.join(' and ')}.`);
      return;
    }
    setVariationError(null);
    cart.add(
      product,
      quantity,
      product.variations.length > 0 ? { ...selectedVariations } : null
    );
    navigate('/cart');
  };
  // An image stays visible as long as none of its variation tags conflict
  // with what the shopper has chosen so far. Untagged values act as
  // wildcards, so an image tagged Color: Red shows before any color is
  // picked and disappears once the shopper picks Blue.
  const visibleImages = product.images.filter((image) => {
    if (!image.url) return false;
    const tags = image.variation_match ?? {};
    return Object.entries(tags).every(([name, value]) => {
      const chosen = selectedVariations[name];
      return chosen === undefined || chosen === value;
    });
  });
  const selectedImage =
    visibleImages.find((image) => image.id === selectedImageId) ?? visibleImages[0] ?? null;
  const primaryImage = selectedImage?.url ?? product.image_url;
  const canPurchase = product.status === 'active' && product.is_public;
  return (
    <section className="store-section store-product-detail">
      <Link className="store-back-link" to="/">Back to store</Link>
      <PageHeading title={product.name}>

        <p>{product.short_description || KIND_LABEL[product.kind]}</p>

      </PageHeading>

      <div className="store-product-detail__layout">
        <Card className="store-product-detail__media" padding="none">
          {primaryImage ? (
            <>
              <ProductImage
                className="store-product-detail__main-image"
                src={primaryImage}
                alt={selectedImage?.alt_text || product.name}
              />
              {visibleImages.length > 1 ? (
                <div className="store-product-detail__thumbs" aria-label="Product images">
                  {visibleImages.map((image) => (
                    <button
                      key={image.id}
                      type="button"
                      className={`store-product-detail__thumb${
                        image.id === selectedImage?.id ? ' is-active' : ''
                      }`}
                      onClick={() => setSelectedImageId(image.id)}
                      aria-label={image.alt_text ? `View ${image.alt_text}` : 'View product image'}
                      aria-pressed={image.id === selectedImage?.id}
                    >
                      <img src={image.thumbnail_url || image.url || ''} alt="" />
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <ProductImage alt={product.name} />
          )}
        </Card>

        <Card className="store-product-detail__buy">
          <div className="store-product-detail__price">
            <strong>{formatMoney(product.unit_amount_cents, product.currency)}</strong>
            <p className="store-product-detail__fulfillment">
              {FULFILLMENT_LABEL[product.fulfillment_type]}
            </p>
          </div>
          <p className="store-product-detail__availability">{canPurchase ? 'Available to order' : 'Currently unavailable'}</p>

          {product.description ? (
            <p className="store-product-detail__description">{product.description}</p>
          ) : null}

          {product.impact_summary ? (
            <p className="store-product-detail__impact">
              <strong>Your impact:</strong> {product.impact_summary}
            </p>
          ) : null}

          {product.variations.length > 0 ? (
            <div className="store-variations">
              {product.variations.map((variation) => {
                const showSwatches = isColorVariation(variation.name);
                return (
                  <fieldset key={variation.name} className="store-variations__group">
                    <legend className="store-variations__label">{variation.name}{selectedVariations[variation.name] ? `: ${selectedVariations[variation.name]}` : ' — choose an option'}</legend>
                    <div className="store-variations__options">
                      {variation.values.map((value) => {
                        const isSelected = selectedVariations[variation.name] === value;
                        const swatch = showSwatches ? resolveColorSwatch(value) : null;
                        return (
                          <label
                            key={value}
                            className={`store-variations__option${isSelected ? ' is-selected' : ''}${
                              swatch ? ' has-swatch' : ''
                            }`}
                          >
                            <input
                              type="radio"
                              name={`variation-${variation.name}`}
                              value={value}
                              checked={isSelected}
                              className="store-variations__input"
                              onChange={() => {
                                setSelectedVariations((current) => ({
                                  ...current,
                                  [variation.name]: value,
                                }));
                                setVariationError(null);
                              }}
                            />
                            {swatch ? (
                              <span
                                className="store-variations__swatch"
                                style={{ background: swatch }}
                                aria-hidden="true"
                              />
                            ) : null}
                            {value}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                );
              })}
              {variationError ? (
                <FormFeedback tone="error">{variationError}</FormFeedback>
              ) : null}
            </div>
          ) : null}

          <div className="store-quantity">
            <span className="store-quantity__label">Quantity</span>
            <div className="store-quantity__group" role="group" aria-label="Quantity">
              <button
                type="button"
                className="store-quantity__btn"
                aria-label="Decrease quantity"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                disabled={quantity <= 1}
              >
                −
              </button>
              <input
                id="store-qty"
                className="store-quantity__input"
                type="number"
                inputMode="numeric"
                min={1}
                aria-label="Quantity"
                value={quantity}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (Number.isFinite(next) && next >= 1) {
                    setQuantity(Math.floor(next));
                  }
                }}
              />
              <button
                type="button"
                className="store-quantity__btn"
                aria-label="Increase quantity"
                onClick={() => setQuantity((q) => q + 1)}
              >
                +
              </button>
            </div>
          </div>

          <Button className="store-product-detail__add" onClick={onAdd} disabled={!canPurchase}>
            {canPurchase ? 'Add to cart' : 'Currently unavailable'}
          </Button>
        </Card>
      </div>
    </section>
  );
}
