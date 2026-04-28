import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, Card, FormFeedback, SectionHeading } from '@olivias/ui';
import { getOrderBySession, type StoreOrder } from '../api';
import { formatMoney, useCart } from '../cart/CartContext';

const POLL_INTERVAL_MS = 1500;
const POLL_MAX_ATTEMPTS = 12;

export function OrderCompletePage() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const [order, setOrder] = useState<StoreOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(true);
  const cart = useCart();
  const cartCleared = useRef(false);

  useEffect(() => {
    if (!cartCleared.current) {
      cart.clear();
      cartCleared.current = true;
    }
  }, [cart]);

  useEffect(() => {
    if (!sessionId) {
      setError('Missing checkout session id.');
      setPending(false);
      return;
    }

    let cancelled = false;
    let attempts = 0;

    const poll = async () => {
      attempts += 1;
      try {
        const found = await getOrderBySession(sessionId);
        if (cancelled) return;
        if (found) {
          setOrder(found);
          setPending(false);
          return;
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Unable to load order.');
        setPending(false);
        return;
      }

      if (attempts >= POLL_MAX_ATTEMPTS) {
        setPending(false);
        return;
      }

      window.setTimeout(poll, POLL_INTERVAL_MS);
    };

    void poll();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (error) {
    return (
      <section className="store-section">
        <FormFeedback tone="error">{error}</FormFeedback>
        <p>
          <Link className="store-back-link" to="/">Back to store</Link>
        </p>
      </section>
    );
  }

  if (pending && !order) {
    return (
      <section className="store-section">
        <SectionHeading
          eyebrow="Thank you"
          title="Finishing up your order…"
          body="We are confirming the payment. This usually takes a few seconds."
        />
      </section>
    );
  }

  if (!order) {
    return (
      <section className="store-section">
        <SectionHeading
          eyebrow="Thank you"
          title="Payment received"
          body="Your order will appear here as soon as payment processing finishes. You can also check 'My orders' once you sign in."
        />
        <Button onClick={() => window.location.reload()}>Refresh</Button>
      </section>
    );
  }

  return (
    <section className="store-section store-order-success">
      <div className="store-order-success__hero">
        <div className="store-order-success__check" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path
              d="M5 12.5l4.2 4.2L19 7.5"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <SectionHeading
          eyebrow="Thank you"
          title="Your order is confirmed"
          body={`A receipt has been sent to ${order.email}.`}
        />
      </div>

      <Card className="store-order-summary">
        <div className="store-order-summary__header">
          <p className="og-section-label">Order #{order.id.slice(0, 8)}</p>
          <strong>{formatMoney(order.totalCents, order.currency)}</strong>
        </div>
        <ul className="store-order-summary__items">
          {order.items.map((item) => (
            <li key={item.id}>
              <span>
                {item.quantity} × {item.productName}
                {item.selectedVariations
                  ? ` (${Object.entries(item.selectedVariations)
                      .map(([name, value]) => `${name}: ${value}`)
                      .join(', ')})`
                  : ''}
              </span>
              <span>{formatMoney(item.totalCents, order.currency)}</span>
            </li>
          ))}
        </ul>
        <div className="store-order-summary__totals">
          <div>
            <span>Subtotal</span>
            <span>{formatMoney(order.subtotalCents, order.currency)}</span>
          </div>
          {order.shippingCents > 0 ? (
            <div>
              <span>Shipping</span>
              <span>{formatMoney(order.shippingCents, order.currency)}</span>
            </div>
          ) : null}
          {order.taxCents > 0 ? (
            <div>
              <span>Tax</span>
              <span>{formatMoney(order.taxCents, order.currency)}</span>
            </div>
          ) : null}
          <div>
            <strong>Total</strong>
            <strong>{formatMoney(order.totalCents, order.currency)}</strong>
          </div>
        </div>
      </Card>

      <p>
        <Link className="store-back-link" to="/">Continue shopping</Link>
      </p>
    </section>
  );
}
