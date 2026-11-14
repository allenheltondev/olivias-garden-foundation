import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, EmptyState, SectionHeading } from '@olivias/ui';
import { listPublicProducts, type StoreProduct } from '../api';
import { formatMoney, useCart } from '../cart/CartContext';

const KIND_LABEL: Record<StoreProduct['kind'], string> = {
  donation: 'Donation',
  merchandise: 'Merchandise',
  ticket: 'Ticket',
  sponsorship: 'Sponsorship',
  other: 'Other',
};

export function BrowsePage() {
  const [products, setProducts] = useState<StoreProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const cart = useCart();
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    listPublicProducts()
      .then((items) => {
        if (!active) return;
        setProducts(items);
      })
      .catch((err: Error) => {
        if (!active) return;
        setError(err.message || 'Unable to load products.');
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  const foundationUrl = (import.meta.env.VITE_FOUNDATION_URL || 'https://oliviasgarden.org').replace(/\/+$/, '');

  return (
    <section className="store-section">
      <SectionHeading
        title="Support Olivia's Garden"
        body="Every purchase helps us grow food, share seeds, and welcome more neighbors into the garden."
      />

      {error ? (
        <div role="alert">
          <EmptyState icon="basket" title="We couldn't load the store." actions={(
            <>
              <Button onClick={() => { setError(null); setProducts(null); setAttempt((value) => value + 1); }}>Try again</Button>
              <a className="og-button og-button--secondary og-button--md" href={`${foundationUrl}/contact`}>Contact the garden</a>
            </>
          )}>
            <p>The catalog is unavailable right now. Try loading it again, or get in touch and we&apos;ll help you find what you need.</p>
          </EmptyState>
        </div>
      ) : null}

      {products && products.length === 0 ? (
        <EmptyState icon="seeds" title="Something new is growing." actions={(
          <a className="og-button og-button--secondary og-button--md" href={foundationUrl}>Visit the garden</a>
        )}>
          <p>No products are available right now. Check back soon, or explore what&apos;s happening at the foundation.</p>
        </EmptyState>
      ) : null}

      {products === null && !error ? (
        <div
          className="store-product-grid store-product-grid--loading"
          aria-busy="true"
          aria-live="polite"
          aria-label="Loading products"
        >
          {Array.from({ length: 6 }).map((_, index) => (
            <Card
              key={index}
              className="store-product-card store-product-card--skeleton"
              padding="none"
              aria-hidden="true"
            >
              <div className="store-product-card__media store-product-card__media--skeleton" />
              <div className="store-product-card__body">
                <div className="skeleton-line skeleton-line--label" />
                <div className="skeleton-line skeleton-line--title" />
                <div className="skeleton-line skeleton-line--text" />
                <div className="skeleton-line skeleton-line--text skeleton-line--text-short" />
                <div className="store-product-card__footer">
                  <div className="skeleton-line skeleton-line--price" />
                  <div className="skeleton-line skeleton-line--button" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      <div className="store-product-grid">
        {(products ?? []).map((product) => (
          <Card key={product.id} className="store-product-card" padding="none">
            <Link to={`/products/${product.slug}`} className="store-product-card__media">
              {product.images[0]?.thumbnail_url || product.image_url ? (
                <img src={product.images[0]?.thumbnail_url || product.image_url || ''} alt="" loading="lazy" />
              ) : (
                <div className="store-product-card__placeholder" aria-hidden="true" />
              )}
            </Link>
            <div className="store-product-card__body">
              <p className="og-section-label">{KIND_LABEL[product.kind]}</p>
              <h3>
                <Link to={`/products/${product.slug}`}>{product.name}</Link>
              </h3>
              {product.short_description ? (
                <p className="store-product-card__excerpt">{product.short_description}</p>
              ) : null}
              <div className="store-product-card__footer">
                <span className="store-product-card__price">
                  {formatMoney(product.unit_amount_cents, product.currency)}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    product.variations.length > 0
                      ? navigate(`/products/${product.slug}`)
                      : cart.add(product, 1)
                  }
                >
                  {product.variations.length > 0 ? 'Choose options' : 'Add to cart'}
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}
