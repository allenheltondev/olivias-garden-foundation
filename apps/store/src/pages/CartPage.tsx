import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, EmptyState, FormFeedback, PageHeading } from '@olivias/ui';
import { ProductImage } from '../components/ProductImage';
import { createCheckoutSession, listPublicProducts } from '../api';
import { formatMoney, isCartLineValidForProduct, useCart } from '../cart/CartContext';
import type { StoreSession } from '../auth/session';

const FULFILLMENT_LABEL: Record<string, string> = {
  shipping: 'Ships to you',
  digital: 'Digital delivery',
  pickup: 'Pickup at the garden',
  none: 'No delivery needed',
};

export interface CartPageProps {
  session: StoreSession | null;
}

export function CartPage({ session }: CartPageProps) {
  const cart = useCart();
  const [error, setError] = useState<string | null>(null);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [pruneNotice, setPruneNotice] = useState<string | null>(null);

  // Stored cart lines can go stale when an admin renames a variation,
  // removes a value, or unpublishes a product. Reconcile against the
  // current public catalog the first time the cart is opened with items
  // present, then leave the cart alone for the rest of the session.
  const hasReconciledRef = useRef(false);
  useEffect(() => {
    if (hasReconciledRef.current) return;
    if (cart.lines.length === 0) return;
    hasReconciledRef.current = true;
    let cancelled = false;
    listPublicProducts()
      .then((products) => {
        if (cancelled) return;
        const productById = new Map(products.map((product) => [product.id, product]));
        const removedNames: string[] = [];
        for (const line of cart.lines) {
          const product = productById.get(line.productId);
          if (!product || !isCartLineValidForProduct(line, product)) {
            removedNames.push(line.name);
            cart.remove(line.lineId);
          }
        }
        if (removedNames.length > 0) {
          const list = removedNames.join(', ');
          setPruneNotice(
            `We removed ${list} from your cart because the available options changed. Please reselect.`
          );
        }
      })
      .catch(() => {
        // Network failures shouldn't block the cart UI; checkout will
        // surface a clearer error if the items really are unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, [cart]);

  const startCheckout = async () => {
    if (cart.lines.length === 0) return;
    setError(null);
    setIsCheckingOut(true);
    try {
      const origin = window.location.origin;
      const { url } = await createCheckoutSession(
        cart.lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          selectedVariations: line.selectedVariations,
        })),
        {
          accessToken: session?.accessToken,
          customerEmail: session?.email ?? undefined,
          successUrl: `${origin}/order-complete?session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${origin}/cart`,
        }
      );
      window.location.assign(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to start checkout.';
      setError(message.includes('origin is not allowed')
        ? 'Checkout is not configured for this store address yet.'
        : message);
      setIsCheckingOut(false);
    }
  };

  if (cart.lines.length === 0) {
    return (
      <section className="store-section">
        <Link className="store-back-link" to="/">Back to store</Link>
        {pruneNotice ? <FormFeedback tone="info">{pruneNotice}</FormFeedback> : null}
        <PageHeading title="Your cart" />
        <EmptyState icon="basket" title="Your cart is empty" actions={(
          <Link className="og-button og-button--primary og-button--md" to="/">Browse the store</Link>
        )}>
          <p>Find something you love and help keep the garden growing.</p>
        </EmptyState>
      </section>
    );
  }
  const itemCount = cart.lines.reduce((total, line) => total + line.quantity, 0);
  const currency = cart.lines[0]?.currency ?? 'usd';
  return (
    <section className="store-section">
      <Link className="store-back-link" to="/">Back to store</Link>
      <PageHeading title="Review your cart">
        <p>{`${itemCount} ${itemCount === 1 ? 'item' : 'items'} ready for checkout.`}</p>
      </PageHeading>

      {pruneNotice ? <FormFeedback tone="info">{pruneNotice}</FormFeedback> : null}
      {error ? <FormFeedback tone="error">{error}</FormFeedback> : null}

      <div className="store-cart-layout">
        <Card className="store-cart">
          <ul className="store-cart__lines">
            {cart.lines.map((line) => (
              <li key={line.lineId} className="store-cart__line">
                <Link
                  to={`/products/${line.slug}`}
                  className="store-cart__line-media"
                  aria-label={`View ${line.name}`}
                >
                  <ProductImage src={line.imageUrl} alt="" />
                </Link>
                <div className="store-cart__line-body">
                  <h2 className="store-cart__line-name">
                    <Link to={`/products/${line.slug}`}>{line.name}</Link>
                  </h2>
                  {line.selectedVariations ? (
                    <p className="store-cart__line-variations">
                      {Object.entries(line.selectedVariations)
                        .map(([name, value]) => `${name}: ${value}`)
                        .join(' · ')}
                    </p>
                  ) : null}
                  <p className="store-cart__line-meta">
                    {FULFILLMENT_LABEL[line.fulfillmentType] ?? line.fulfillmentType}
                  </p>
                  <div className="store-cart__line-controls">
                    <div
                      className="store-quantity__group"
                      role="group"
                      aria-label={`Quantity for ${line.name}`}
                    >
                      <button
                        type="button"
                        className="store-quantity__btn"
                        aria-label="Decrease quantity"
                        onClick={() =>
                          cart.setQuantity(line.lineId, Math.max(0, line.quantity - 1))
                        }
                      >
                        −
                      </button>
                      <input
                        className="store-quantity__input"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        aria-label={`Quantity for ${line.name}`}
                        value={line.quantity}
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          if (Number.isFinite(next)) {
                            cart.setQuantity(line.lineId, Math.max(0, Math.floor(next)));
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="store-quantity__btn"
                        aria-label="Increase quantity"
                        onClick={() =>
                          cart.setQuantity(line.lineId, line.quantity + 1)
                        }
                      >
                        +
                      </button>
                    </div>
                    <button
                      type="button"
                      className="store-cart__line-remove"
                      onClick={() => cart.remove(line.lineId)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <div className="store-cart__line-total">
                  {formatMoney(line.unitAmountCents * line.quantity, line.currency)}
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="store-cart__summary-card">
          <h2 className="store-cart__summary-title">Order summary</h2>
          <div className="store-cart__summary-row">
            <span>Subtotal</span>
            <span>{formatMoney(cart.subtotalCents, currency)}</span>
          </div>
          {cart.requiresShipping ? (
            <p className="store-cart__shipping-note">
              Shipping and tax are calculated during checkout.
            </p>
          ) : null}

          <Button
            className="store-cart__checkout-action"
            onClick={startCheckout}
            loading={isCheckingOut}
            disabled={isCheckingOut}
          >
            {isCheckingOut ? 'Opening checkout…' : 'Checkout'}
          </Button>
          {!session ? (
            <p className="store-cart__guest-note">
              You can checkout as a guest. Sign in if you want this purchase saved to your account.
            </p>
          ) : null}
        </Card>
      </div>
    </section>
  );
}
