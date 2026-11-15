import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, FormFeedback, PageHeading } from '@olivias/ui';
import { listMyOrders, type StoreOrder } from '../api';
import { formatMoney } from '../cart/CartContext';
import type { StoreSession } from '../auth/session';

export interface OrdersPageProps {
  session: StoreSession;
}

const STATUS_LABEL: Record<StoreOrder['status'], string> = {
  pending: 'Pending',
  paid: 'Paid',
  failed: 'Failed',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

export function OrdersPage({ session }: OrdersPageProps) {
  const [orders, setOrders] = useState<StoreOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listMyOrders(session.accessToken)
      .then((items) => {
        if (!active) return;
        setOrders(items);
      })
      .catch((err: Error) => {
        if (!active) return;
        setError(err.message || 'Unable to load orders.');
      });
    return () => {
      active = false;
    };
  }, [session.accessToken]);

  return (
    <section className="store-section">
      <PageHeading title="My orders">
        <p>A history of everything you've contributed to or purchased from the garden.</p>
      </PageHeading>

      {error ? <FormFeedback tone="error">{error}</FormFeedback> : null}

      {orders && orders.length === 0 ? (
        <p className="store-empty">
          You haven't placed any orders yet. <Link to="/">Browse the store</Link>.
        </p>
      ) : null}

      {orders === null && !error ? (
        <div
          className="store-order-list store-order-list--loading"
          aria-busy="true"
          aria-live="polite"
          aria-label="Loading orders"
        >
          {Array.from({ length: 3 }).map((_, index) => (
            <Card
              key={index}
              className="store-order-list__item store-order-list__item--skeleton"
              aria-hidden="true"
            >
              <div className="store-order-list__header">
                <div>
                  <div className="skeleton-line skeleton-line--status" />
                  <div className="skeleton-line skeleton-line--title" />
                  <div className="skeleton-line skeleton-line--meta" />
                </div>
                <div className="skeleton-line skeleton-line--total" />
              </div>
              <ul className="store-order-list__lines">
                <li>
                  <div className="skeleton-line skeleton-line--text" />
                  <div className="skeleton-line skeleton-line--price" />
                </li>
                <li>
                  <div className="skeleton-line skeleton-line--text skeleton-line--text-short" />
                  <div className="skeleton-line skeleton-line--price" />
                </li>
              </ul>
            </Card>
          ))}
        </div>
      ) : null}

      <div className="store-order-list">
        {(orders ?? []).map((order) => (
          <Card key={order.id} className="store-order-list__item">
            <div className="store-order-list__header">
              <div>
                <span className={`store-order-status store-order-status--${order.status}`}>
                  {STATUS_LABEL[order.status]}
                </span>
                <p className="store-order-list__id">Order #{order.id.slice(0, 8)}</p>
                <p className="store-order-list__date">
                  Placed {dateFormatter.format(new Date(order.createdAt))}
                </p>
              </div>
              <span className="store-order-list__total">
                {formatMoney(order.totalCents, order.currency)}
              </span>
            </div>
            <ul className="store-order-list__lines">
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
          </Card>
        ))}
      </div>
    </section>
  );
}
