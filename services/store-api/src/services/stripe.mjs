import crypto from 'node:crypto';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

export class StripeClient {
  static fromEnv() {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }
    return new StripeClient(secretKey);
  }

  constructor(secretKey, fetchImpl = fetch) {
    this.secretKey = secretKey;
    this.fetchImpl = fetchImpl;
  }

  requestHeaders() {
    return {
      authorization: `Basic ${Buffer.from(`${this.secretKey}:`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded'
    };
  }

  async createCheckoutSession({
    items,
    successUrl,
    cancelUrl,
    customerEmail,
    requiresShipping,
    metadata = {}
  }) {
    const form = new URLSearchParams();
    form.set('mode', 'payment');
    form.set('success_url', successUrl);
    form.set('cancel_url', cancelUrl);

    if (customerEmail) {
      form.set('customer_email', customerEmail);
    }

    if (requiresShipping) {
      form.set('shipping_address_collection[allowed_countries][0]', 'US');
      form.set('shipping_address_collection[allowed_countries][1]', 'CA');
      form.set('phone_number_collection[enabled]', 'true');
    }

    items.forEach((item, index) => {
      form.set(`line_items[${index}][price]`, item.priceId);
      form.set(`line_items[${index}][quantity]`, String(item.quantity));
    });

    Object.entries(metadata).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        form.set(`metadata[${key}]`, String(value));
      }
    });

    const response = await this.fetchImpl(`${STRIPE_API_BASE}/checkout/sessions`, {
      method: 'POST',
      headers: this.requestHeaders(),
      body: form
    });

    const body = await response.json();

    if (!response.ok) {
      throw new Error(`Stripe checkout session creation failed (${response.status}): ${JSON.stringify(body)}`);
    }

    if (!body.id || !body.url) {
      throw new Error('Stripe checkout session response missing id or url');
    }

    return { id: body.id, url: body.url };
  }

  async getCheckoutSession(sessionId) {
    const url = new URL(`${STRIPE_API_BASE}/checkout/sessions/${encodeURIComponent(sessionId)}`);
    url.searchParams.append('expand[]', 'line_items');
    url.searchParams.append('expand[]', 'shipping_cost');

    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: this.requestHeaders()
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(`Stripe checkout session fetch failed (${response.status}): ${JSON.stringify(body)}`);
    }
    return body;
  }
}

// Verify a Stripe webhook signature.
// https://stripe.com/docs/webhooks/signatures
export function verifyWebhookSignature({ payload, signatureHeader, secret, toleranceSeconds = 300, now = Date.now }) {
  if (!signatureHeader) {
    throw new Error('Missing Stripe-Signature header');
  }
  if (!secret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  }

  const parts = String(signatureHeader)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  let timestamp = null;
  const signatures = [];
  for (const part of parts) {
    const [key, value] = part.split('=');
    if (key === 't' && value) timestamp = Number(value);
    if (key === 'v1' && value) signatures.push(value);
  }

  if (!timestamp || signatures.length === 0) {
    throw new Error('Invalid Stripe-Signature header');
  }

  const nowSeconds = Math.floor(now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    throw new Error('Stripe signature timestamp outside tolerance');
  }

  const signedPayload = `${timestamp}.${payload}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');

  const matches = signatures.some((sig) => {
    try {
      const sigBuf = Buffer.from(sig, 'hex');
      return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
    } catch {
      return false;
    }
  });

  if (!matches) {
    throw new Error('Stripe signature verification failed');
  }
}
