import { useEffect, useMemo, useState } from 'react';
import { Card, FormFeedback, SectionHeading } from '@olivias/ui';
import { listStoreOrders, type StoreOrder } from '../api';
import type { AdminSession } from '../auth/session';

export interface StoreOrdersPageProps {
  session: AdminSession;
}

const STATUS_LABEL: Record<StoreOrder['status'], string> = {
  pending: 'Pending',
  paid: 'Paid',
  failed: 'Failed',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

const FULFILLMENT_LABEL: Record<StoreOrder['fulfillmentStatus'], string> = {
  unfulfilled: 'Unfulfilled',
  fulfilled: 'Fulfilled',
  shipped: 'Shipped',
  delivered: 'Delivered',
};

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export function StoreOrdersPage({ session }: StoreOrdersPageProps) {
  const [orders, setOrders] = useState<StoreOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listStoreOrders(session.accessToken)
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

  const summary = useMemo(() => {
    if (!orders) return null;
    const paid = orders.filter((o) => o.status === 'paid');
    const totalRevenue = paid.reduce((sum, o) => sum + o.totalCents, 0);
    const currency = paid[0]?.currency ?? 'usd';
    return {
      paidCount: paid.length,
      unfulfilledCount: paid.filter((o) => o.fulfillmentStatus === 'unfulfilled').length,
      totalRevenue,
      currency,
    };
  }, [orders]);

  return (
    <section className="admin-section">
      <SectionHeading
        eyebrow="Store"
        title="Customer orders"
        body="Review every order placed through the store, including guest checkouts."
      />

      {error ? <FormFeedback tone="error">{error}</FormFeedback> : null}

      {summary ? (
        <div className="admin-store-orders__summary">
          <Card>
            <p className="og-section-label">Paid orders</p>
            <strong>{summary.paidCount}</strong>
          </Card>
          <Card>
            <p className="og-section-label">Unfulfilled</p>
            <strong>{summary.unfulfilledCount}</strong>
          </Card>
          <Card>
            <p className="og-section-label">Lifetime revenue</p>
            <strong>{formatMoney(summary.totalRevenue, summary.currency)}</strong>
          </Card>
        </div>
      ) : null}

      {orders === null && !error ? <p className="admin-store-list__empty">Loading orders…</p> : null}

      {orders && orders.length === 0 ? (
        <p className="admin-store-list__empty">No orders yet.</p>
      ) : null}

      <div className="admin-store-orders">
        {(orders ?? []).map((order) => (
          <Card key={order.id} className="admin-store-orders__row">
            <div className="admin-store-orders__row-head">
              <div>
                <p className="og-section-label">
                  {STATUS_LABEL[order.status]} · {FULFILLMENT_LABEL[order.fulfillmentStatus]}
                </p>
                <strong>Order #{order.id.slice(0, 8)}</strong>
                <small> · {new Date(order.createdAt).toLocaleString()}</small>
              </div>
              <strong>{formatMoney(order.totalCents, order.currency)}</strong>
            </div>
            <div className="admin-store-orders__row-meta">
              <div>
                <p className="og-section-label">Customer</p>
                <span>{order.customerName ?? order.email}</span>
                <small>{order.email}{order.userId ? ' · account' : ' · guest'}</small>
              </div>
              {order.shippingAddress ? (
                <div>
                  <p className="og-section-label">Ship to</p>
                  <span>
                    {[order.shippingAddress.line1, order.shippingAddress.line2]
                      .filter(Boolean)
                      .join(', ')}
                  </span>
                  <small>
                    {[
                      order.shippingAddress.city,
                      order.shippingAddress.state,
                      order.shippingAddress.postal_code,
                      order.shippingAddress.country,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  </small>
                </div>
              ) : null}
            </div>
            <ul className="admin-store-orders__items">
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
