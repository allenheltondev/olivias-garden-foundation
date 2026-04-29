import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, FormFeedback, SectionHeading } from '@olivias/ui';
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
  }, []);

  return (
    <section className="store-section">
      <SectionHeading
        eyebrow="Store"
        title="Support Olivia's Garden"
        body="Every purchase helps us grow food, share seeds, and welcome more neighbors into the garden."
      />

      {error ? <FormFeedback tone="error">{error}</FormFeedback> : null}

      {products === null && !error ? (
        <p className="store-empty">Loading products…</p>
      ) : null}

      {products && products.length === 0 ? (
        <p className="store-empty">No products are available right now. Check back soon.</p>
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
