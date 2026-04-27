import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, Card, FormFeedback, Input, SectionHeading } from '@olivias/ui';
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
  none: 'No fulfillment required',
  digital: 'Digital delivery',
  shipping: 'Ships to your address',
  pickup: 'Pickup',
};

export function ProductPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const [product, setProduct] = useState<StoreProduct | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const cart = useCart();
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    setProduct(null);
    setError(null);

    getProductBySlug(slug)
      .then((next) => {
        if (!active) return;
        setProduct(next);
      })
      .catch((err: Error) => {
        if (!active) return;
        setError(err.message || 'Unable to load product.');
      });

    return () => {
      active = false;
    };
  }, [slug]);

  if (error) {
    return (
      <section className="store-section">
        <FormFeedback tone="error">{error}</FormFeedback>
        <p>
          <Link to="/">Back to all products</Link>
        </p>
      </section>
    );
  }

  if (!product) {
    return <p className="store-empty">Loading product…</p>;
  }

  const onAdd = () => {
    cart.add(product, quantity);
    navigate('/cart');
  };

  return (
    <section className="store-section store-product-detail">
      <SectionHeading
        eyebrow={KIND_LABEL[product.kind]}
        title={product.name}
        body={product.short_description ?? undefined}
      />

      <div className="store-product-detail__layout">
        <Card className="store-product-detail__media">
          {product.image_url ? (
            <img src={product.image_url} alt="" />
          ) : (
            <div className="store-product-card__placeholder" aria-hidden="true" />
          )}
        </Card>

        <Card className="store-product-detail__buy">
          <div className="store-product-detail__price">
            <strong>{formatMoney(product.unit_amount_cents, product.currency)}</strong>
            <span className="og-section-label">{FULFILLMENT_LABEL[product.fulfillment_type]}</span>
          </div>

          {product.description ? (
            <p className="store-product-detail__description">{product.description}</p>
          ) : null}

          {product.impact_summary ? (
            <p className="store-product-detail__impact">
              <strong>Your impact:</strong> {product.impact_summary}
            </p>
          ) : null}

          <div className="store-quantity">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Decrease quantity"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            >
              −
            </Button>
            <Input
              id="store-qty"
              type="number"
              label="Quantity"
              min={1}
              value={quantity}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isFinite(next) && next >= 1) {
                  setQuantity(Math.floor(next));
                }
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              aria-label="Increase quantity"
              onClick={() => setQuantity((q) => q + 1)}
            >
              +
            </Button>
          </div>

          <Button onClick={onAdd}>Add to cart</Button>
        </Card>
      </div>

      <p className="store-product-detail__back">
        <Link to="/">← Back to all products</Link>
      </p>
    </section>
  );
}
