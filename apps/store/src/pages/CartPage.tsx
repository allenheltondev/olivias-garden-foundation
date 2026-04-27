import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, FormFeedback, Input, SectionHeading } from '@olivias/ui';
import { createCheckoutSession } from '../api';
import { formatMoney, useCart } from '../cart/CartContext';
import type { StoreSession } from '../auth/session';

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
        cart.lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
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
        <SectionHeading eyebrow="Cart" title="Your cart is empty" />
        <p>
          <Link to="/">Browse the store</Link> to find something you love.
        </p>
      </section>
    );
  }

  return (
    <section className="store-section">
      <SectionHeading eyebrow="Cart" title="Review your cart" />

      {error ? <FormFeedback tone="error">{error}</FormFeedback> : null}

      <Card className="store-cart">
        <ul className="store-cart__lines">
          {cart.lines.map((line) => (
            <li key={line.productId} className="store-cart__line">
              <div className="store-cart__line-media" aria-hidden="true">
                {line.imageUrl ? <img src={line.imageUrl} alt="" /> : <div className="store-product-card__placeholder" />}
              </div>
              <div className="store-cart__line-body">
                <Link to={`/products/${line.slug}`}>
                  <strong>{line.name}</strong>
                </Link>
                <span className="og-section-label">{line.fulfillmentType === 'shipping' ? 'Ships to you' : line.fulfillmentType}</span>
                <div className="store-cart__line-controls">
                  <Input
                    type="number"
                    label="Qty"
                    min={1}
                    value={line.quantity}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      if (Number.isFinite(next)) {
                        cart.setQuantity(line.productId, Math.max(0, Math.floor(next)));
                      }
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => cart.remove(line.productId)}
                  >
                    Remove
                  </Button>
                </div>
              </div>
              <div className="store-cart__line-total">
                {formatMoney(line.unitAmountCents * line.quantity, line.currency)}
              </div>
            </li>
          ))}
        </ul>
        <div className="store-cart__summary">
          <div className="store-cart__summary-row">
            <span>Subtotal</span>
            <strong>{formatMoney(cart.subtotalCents, cart.lines[0]?.currency ?? 'usd')}</strong>
          </div>
          {cart.requiresShipping ? (
            <p className="store-cart__shipping-note">
              Shipping address and any shipping costs are calculated at checkout.
            </p>
          ) : null}
          <Button className="store-cart__checkout-action" onClick={startCheckout} loading={isCheckingOut} disabled={isCheckingOut}>
            {isCheckingOut ? 'Opening checkout...' : 'Checkout'}
          </Button>
          {!session ? (
            <p className="store-cart__guest-note">
              You can checkout as a guest. Sign in if you want this purchase saved to your account.
            </p>
          ) : null}
        </div>
      </Card>
    </section>
  );
}
