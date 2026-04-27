import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, FormFeedback, SectionHeading } from '@olivias/ui';
import { createCheckoutSession } from '../api';
import { formatMoney, useCart } from '../cart/CartContext';
import type { StoreSession } from '../auth/session';

const FULFILLMENT_LABEL: Record<string, string> = {
  shipping: 'Ships to you',
  digital: 'Digital delivery',
  pickup: 'Pickup at the garden',
  none: 'No fulfillment required',
};

export interface CartPageProps {
  session: StoreSession | null;
}

export function CartPage({ session }: CartPageProps) {
  const cart = useCart();
  const [error, setError] = useState<string | null>(null);
  const [isCheckingOut, setIsCheckingOut] = useState(false);

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
        <Card className="store-cart-empty">
          <div className="store-cart-empty__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M4 7h16l-1.2 11.1a2 2 0 0 1-2 1.9H7.2a2 2 0 0 1-2-1.9L4 7Zm4 0V5a4 4 0 0 1 8 0v2"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <SectionHeading eyebrow="Cart" title="Your cart is empty" />
          <p>
            <Link to="/">Browse the store</Link> to find something you love.
          </p>
        </Card>
      </section>
    );
  }

  const itemCount = cart.lines.reduce((total, line) => total + line.quantity, 0);
  const currency = cart.lines[0]?.currency ?? 'usd';

  return (
    <section className="store-section">
      <Link className="store-back-link" to="/">Back to store</Link>
      <SectionHeading
        eyebrow="Cart"
        title="Review your cart"
        body={`${itemCount} ${itemCount === 1 ? 'item' : 'items'} ready for checkout.`}
      />

      {error ? <FormFeedback tone="error">{error}</FormFeedback> : null}

      <div className="store-cart-layout">
        <Card className="store-cart">
          <ul className="store-cart__lines">
            {cart.lines.map((line) => (
              <li key={line.lineId} className="store-cart__line">
                <Link
                  to={`/products/${line.slug}`}
                  className="store-cart__line-media"
                  aria-hidden={line.imageUrl ? undefined : true}
                >
                  {line.imageUrl ? (
                    <img src={line.imageUrl} alt="" />
                  ) : (
                    <div className="store-product-card__placeholder" />
                  )}
                </Link>
                <div className="store-cart__line-body">
                  <h3 className="store-cart__line-name">
                    <Link to={`/products/${line.slug}`}>{line.name}</Link>
                  </h3>
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
          <div className="store-cart__summary-row store-cart__summary-row--total">
            <span>Total</span>
            <strong>{formatMoney(cart.subtotalCents, currency)}</strong>
          </div>
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
