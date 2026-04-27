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
