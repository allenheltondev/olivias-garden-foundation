import { query, withTransaction } from './db.mjs';
import { extractAuthContext, requireAdmin, requireUser } from './auth.mjs';
import { loadProductsForCheckout } from './products.mjs';
import { StripeClient, verifyWebhookSignature } from './stripe.mjs';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ORDER_SELECT_COLUMNS = `
  o.id, o.user_id, o.email, o.customer_name,
  o.stripe_checkout_session_id, o.stripe_payment_intent_id, o.stripe_customer_id,
  o.subtotal_cents, o.shipping_cents, o.tax_cents, o.total_cents, o.currency,
  o.status, o.fulfillment_status, o.shipping_address, o.metadata,
  o.created_at, o.updated_at, o.paid_at
`;

const ORDER_ITEM_SELECT_COLUMNS = `
  i.id, i.order_id, i.product_id, i.product_slug, i.product_name, i.product_kind,
  i.quantity, i.unit_amount_cents, i.total_cents, i.stripe_price_id
`;

function mapOrder(orderRow, items) {
  return {
    id: orderRow.id,
    userId: orderRow.user_id,
    email: orderRow.email,
    customerName: orderRow.customer_name,
    stripeCheckoutSessionId: orderRow.stripe_checkout_session_id,
    stripePaymentIntentId: orderRow.stripe_payment_intent_id,
    stripeCustomerId: orderRow.stripe_customer_id,
    subtotalCents: orderRow.subtotal_cents,
    shippingCents: orderRow.shipping_cents,
    taxCents: orderRow.tax_cents,
    totalCents: orderRow.total_cents,
    currency: orderRow.currency,
    status: orderRow.status,
    fulfillmentStatus: orderRow.fulfillment_status,
    shippingAddress: orderRow.shipping_address ?? null,
    metadata: orderRow.metadata ?? {},
    items: items.map((item) => ({
      id: item.id,
      productId: item.product_id,
      productSlug: item.product_slug,
      productName: item.product_name,
      productKind: item.product_kind,
      quantity: item.quantity,
      unitAmountCents: item.unit_amount_cents,
      totalCents: item.total_cents,
      stripePriceId: item.stripe_price_id
    })),
    createdAt: orderRow.created_at?.toISOString?.() ?? orderRow.created_at,
    updatedAt: orderRow.updated_at?.toISOString?.() ?? orderRow.updated_at,
    paidAt: orderRow.paid_at?.toISOString?.() ?? orderRow.paid_at
  };
}

async function loadOrdersWithItems(rows) {
  if (rows.length === 0) return [];
  const orderIds = rows.map((row) => row.id);
  const itemsResult = await query(
    `select ${ORDER_ITEM_SELECT_COLUMNS}
       from store_order_items i
      where i.order_id = any($1::uuid[])
      order by i.created_at asc`,
    [orderIds]
  );
  const itemsByOrder = new Map();
  for (const item of itemsResult.rows) {
    const list = itemsByOrder.get(item.order_id) ?? [];
    list.push(item);
    itemsByOrder.set(item.order_id, list);
  }
  return rows.map((row) => mapOrder(row, itemsByOrder.get(row.id) ?? []));
}

function validateCheckoutPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Request body is required');
  }

  const items = payload.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Cart is empty');
  }

  for (const item of items) {
    if (!item || typeof item !== 'object') {
      throw new Error('Validation: each item must be an object');
    }
    if (typeof item.productId !== 'string' || !UUID_PATTERN.test(item.productId)) {
      throw new Error('Validation: productId must be a valid UUID');
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 999) {
      throw new Error('Quantity must be an integer between 1 and 999');
    }
  }

  if (typeof payload.success_url !== 'string' || !/^https?:\/\//.test(payload.success_url)) {
    throw new Error('Validation: success_url is required');
  }
  if (typeof payload.cancel_url !== 'string' || !/^https?:\/\//.test(payload.cancel_url)) {
    throw new Error('Validation: cancel_url is required');
  }
}

export async function createCheckoutSession(event, payload, options = {}) {
  validateCheckoutPayload(payload);
  const auth = extractAuthContext(event);

  const productIds = payload.items.map((item) => item.productId);
  const products = await loadProductsForCheckout(productIds);
  if (products.length !== productIds.length) {
    throw new Error('One or more products in your cart are no longer available.');
  }

  const productById = new Map(products.map((p) => [p.id, p]));
  const lineItems = payload.items.map((item) => {
    const product = productById.get(item.productId);
    if (!product) {
      throw new Error('One or more products in your cart are no longer available.');
    }
    if (product.status !== 'active' || !product.is_public) {
      throw new Error(`Product ${product.name} is no longer available.`);
    }
    return { product, quantity: item.quantity };
  });

  const currencies = new Set(lineItems.map((line) => line.product.currency.toLowerCase()));
  if (currencies.size > 1) {
    throw new Error('Mismatched currencies in cart. Please remove items with different currencies.');
  }

  const requiresShipping = lineItems.some(
    (line) => line.product.fulfillment_type === 'shipping'
  );

  const stripe = options.stripeClient ?? StripeClient.fromEnv();

  const customerEmail =
    typeof payload.customer_email === 'string' && payload.customer_email.trim().length > 0
      ? payload.customer_email.trim()
      : auth.email ?? undefined;

  const session = await stripe.createCheckoutSession({
    items: lineItems.map((line) => ({
      priceId: line.product.stripe_price_id,
      quantity: line.quantity
    })),
    successUrl: payload.success_url,
    cancelUrl: payload.cancel_url,
    customerEmail,
    requiresShipping,
    metadata: {
      og_user_id: auth.userId ?? '',
      og_product_ids: lineItems.map((line) => line.product.id).join(',')
    }
  });

  return {
    sessionId: session.id,
    url: session.url
  };
}

function extractShippingAddress(stripeSession) {
  const collected = stripeSession?.shipping_details ?? stripeSession?.customer_details;
  const address = collected?.address;
  if (!address) return null;
  return {
    name: collected?.name ?? null,
    line1: address.line1 ?? null,
    line2: address.line2 ?? null,
    city: address.city ?? null,
    state: address.state ?? null,
    postal_code: address.postal_code ?? null,
    country: address.country ?? null
  };
}

async function findUserIdByEmail(email) {
  if (!email) return null;
  const result = await query(
    `select id from users where email = $1 and deleted_at is null limit 1`,
    [email]
  );
  return result.rows[0]?.id ?? null;
}

async function recordPaidOrder(stripeSession) {
  const sessionId = stripeSession.id;
  if (!sessionId) {
    throw new Error('Stripe session is missing id');
  }

  const paymentIntentId =
    typeof stripeSession.payment_intent === 'string'
      ? stripeSession.payment_intent
      : stripeSession.payment_intent?.id ?? null;
  const stripeCustomerId =
    typeof stripeSession.customer === 'string'
      ? stripeSession.customer
      : stripeSession.customer?.id ?? null;

  const email =
    stripeSession.customer_details?.email ??
    stripeSession.customer_email ??
    null;
  if (!email) {
    throw new Error('Stripe session has no customer email; cannot record order');
  }

  const customerName = stripeSession.customer_details?.name ?? null;
  const currency = String(stripeSession.currency ?? 'usd').toLowerCase();

  const totalCents = Number.isInteger(stripeSession.amount_total)
    ? stripeSession.amount_total
    : 0;
  const subtotalCents = Number.isInteger(stripeSession.amount_subtotal)
    ? stripeSession.amount_subtotal
    : totalCents;
  const taxCents = Number.isInteger(stripeSession.total_details?.amount_tax)
    ? stripeSession.total_details.amount_tax
    : 0;
  const shippingCents = Number.isInteger(stripeSession.total_details?.amount_shipping)
    ? stripeSession.total_details.amount_shipping
    : 0;

  const metadataUserId =
    typeof stripeSession.metadata?.og_user_id === 'string' &&
    stripeSession.metadata.og_user_id.length > 0
      ? stripeSession.metadata.og_user_id
      : null;

  const userId = metadataUserId ?? (await findUserIdByEmail(email));
  const shippingAddress = extractShippingAddress(stripeSession);

  const lineItems = stripeSession.line_items?.data ?? [];

  return withTransaction(async (client) => {
    const existing = await client.query(
      `select id from store_orders where stripe_checkout_session_id = $1 limit 1`,
      [sessionId]
    );
    if (existing.rows.length > 0) {
      // Idempotent: already recorded.
      return existing.rows[0].id;
    }

    const orderResult = await client.query(
      `insert into store_orders (
         user_id, email, customer_name,
         stripe_checkout_session_id, stripe_payment_intent_id, stripe_customer_id,
         subtotal_cents, shipping_cents, tax_cents, total_cents, currency,
         status, fulfillment_status, shipping_address, paid_at
       )
       values (
         $1, $2, $3,
         $4, $5, $6,
         $7, $8, $9, $10, $11,
         'paid', 'unfulfilled', $12, now()
       )
       returning id`,
      [
        userId,
        email,
        customerName,
        sessionId,
        paymentIntentId,
        stripeCustomerId,
        subtotalCents,
        shippingCents,
        taxCents,
        totalCents,
        currency,
        shippingAddress ? JSON.stringify(shippingAddress) : null
      ]
    );
    const orderId = orderResult.rows[0].id;

    for (const line of lineItems) {
      const stripePriceId = line.price?.id ?? null;
      const productLookup = stripePriceId
        ? await client.query(
            `select id, slug, name, kind::text as kind
               from store_products
              where stripe_price_id = $1
              limit 1`,
            [stripePriceId]
          )
        : { rows: [] };
      const product = productLookup.rows[0];
      const quantity = line.quantity ?? 1;
      const unitAmountCents = line.price?.unit_amount ?? Math.round((line.amount_total ?? 0) / quantity);
      const totalLineCents = line.amount_total ?? unitAmountCents * quantity;

      await client.query(
        `insert into store_order_items (
           order_id, product_id, product_slug, product_name, product_kind,
           quantity, unit_amount_cents, total_cents, stripe_price_id
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          orderId,
          product?.id ?? null,
          product?.slug ?? line.description ?? 'unknown',
          product?.name ?? line.description ?? 'Unknown product',
          product?.kind ?? 'other',
          quantity,
          unitAmountCents,
          totalLineCents,
          stripePriceId
        ]
      );
    }

    return orderId;
  });
}

export async function handleStripeWebhook(rawBody, signatureHeader, options = {}) {
  const secret = options.webhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET;
  verifyWebhookSignature({
    payload: rawBody,
    signatureHeader,
    secret
  });

  const event = JSON.parse(rawBody);

  if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') {
    return { handled: false, type: event.type };
  }

  const sessionPreview = event.data?.object;
  if (!sessionPreview?.id) {
    throw new Error('Stripe webhook missing session id');
  }

  const paymentStatus = sessionPreview.payment_status;
  if (paymentStatus && paymentStatus !== 'paid' && paymentStatus !== 'no_payment_required') {
    return { handled: false, reason: `payment_status=${paymentStatus}` };
  }

  const stripe = options.stripeClient ?? StripeClient.fromEnv();
  const fullSession = await stripe.getCheckoutSession(sessionPreview.id);
  const orderId = await recordPaidOrder(fullSession);

  return { handled: true, orderId };
}

export async function getOrderByStripeSession(sessionId) {
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
    throw new Error('Validation: sessionId is required');
  }
  const result = await query(
    `select ${ORDER_SELECT_COLUMNS}
       from store_orders o
      where o.stripe_checkout_session_id = $1
      limit 1`,
    [sessionId.trim()]
  );
  if (result.rows.length === 0) {
    throw new Error('Order not found');
  }
  const [order] = await loadOrdersWithItems(result.rows);
  return order;
}

export async function listMyOrders(event) {
  const auth = extractAuthContext(event);
  requireUser(auth);

  const result = await query(
    `select ${ORDER_SELECT_COLUMNS}
       from store_orders o
      where o.user_id = $1
      order by o.created_at desc
      limit 200`,
    [auth.userId]
  );
  return { items: await loadOrdersWithItems(result.rows) };
}

export async function listAdminOrders(event) {
  const auth = extractAuthContext(event);
  requireAdmin(auth);

  const result = await query(
    `select ${ORDER_SELECT_COLUMNS}
       from store_orders o
      order by o.created_at desc
      limit 500`
  );
  return { items: await loadOrdersWithItems(result.rows) };
}
