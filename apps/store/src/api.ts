export interface StoreProduct {
  id: string;
  slug: string;
  name: string;
  short_description: string | null;
  description: string | null;
  status: 'draft' | 'active' | 'archived';
  kind: 'donation' | 'merchandise' | 'ticket' | 'sponsorship' | 'other';
  fulfillment_type: 'none' | 'digital' | 'shipping' | 'pickup';
  is_public: boolean;
  is_featured: boolean;
  currency: string;
  unit_amount_cents: number;
  statement_descriptor: string | null;
  nonprofit_program: string | null;
  impact_summary: string | null;
  image_url: string | null;
  legacy_image_url: string | null;
  image_urls: string[];
  images: StoreProductImage[];
  metadata: Record<string, unknown>;
  stripe_product_id: string;
  stripe_price_id: string;
  created_at: string;
  updated_at: string;
}

export interface StoreProductImage {
  id: string;
  product_id: string | null;
  status: 'uploaded' | 'processing' | 'ready' | 'failed';
  url: string | null;
  thumbnail_url: string | null;
  width: number | null;
  height: number | null;
  byte_size: number | null;
  sort_order: number;
  alt_text: string | null;
  processing_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface CheckoutLineItemInput {
  productId: string;
  quantity: number;
}

export interface CheckoutSessionResponse {
  url: string;
  sessionId: string;
}

export interface StoreOrderItem {
  id: string;
  productId: string | null;
  productSlug: string;
  productName: string;
  productKind: StoreProduct['kind'];
  quantity: number;
  unitAmountCents: number;
  totalCents: number;
}

export interface StoreOrder {
  id: string;
  userId: string | null;
  email: string;
  customerName: string | null;
  status: 'pending' | 'paid' | 'failed' | 'cancelled' | 'refunded';
  fulfillmentStatus: 'unfulfilled' | 'fulfilled' | 'shipped' | 'delivered';
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  shippingAddress: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
    name?: string;
  } | null;
  items: StoreOrderItem[];
  createdAt: string;
  paidAt: string | null;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function getStoreApiBaseUrl(): string {
  const baseUrl = import.meta.env.VITE_STORE_API_URL;
  if (!baseUrl) {
    throw new Error('Missing VITE_STORE_API_URL for store app.');
  }
  return trimTrailingSlash(baseUrl);
}

async function requestJson<T>(url: string, init: RequestInit = {}, accessToken?: string): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetch(url, { ...init, headers });

  if (!response.ok) {
    let message = response.statusText;
    try {
      const payload = await response.json();
      message = payload.message || payload.error?.message || payload.error || message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export async function listPublicProducts(): Promise<StoreProduct[]> {
  const response = await requestJson<{ items: StoreProduct[] }>(
    `${getStoreApiBaseUrl()}/products`
  );
  return response.items;
}

export async function getProductBySlug(slug: string): Promise<StoreProduct> {
  return requestJson<StoreProduct>(`${getStoreApiBaseUrl()}/products/${encodeURIComponent(slug)}`);
}

export async function createCheckoutSession(
  items: CheckoutLineItemInput[],
  options: {
    accessToken?: string;
    successUrl: string;
    cancelUrl: string;
    customerEmail?: string;
  }
): Promise<CheckoutSessionResponse> {
  return requestJson<CheckoutSessionResponse>(
    `${getStoreApiBaseUrl()}/checkout`,
    {
      method: 'POST',
      body: JSON.stringify({
        items,
        success_url: options.successUrl,
        cancel_url: options.cancelUrl,
        customer_email: options.customerEmail,
      }),
    },
    options.accessToken
  );
}

export async function getOrderBySession(sessionId: string): Promise<StoreOrder | null> {
  try {
    return await requestJson<StoreOrder>(
      `${getStoreApiBaseUrl()}/orders/by-session/${encodeURIComponent(sessionId)}`
    );
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return null;
    }
    throw error;
  }
}

export async function listMyOrders(accessToken: string): Promise<StoreOrder[]> {
  const response = await requestJson<{ items: StoreOrder[] }>(
    `${getStoreApiBaseUrl()}/orders`,
    {},
    accessToken
  );
  return response.items;
}

export async function listAllOrders(accessToken: string): Promise<StoreOrder[]> {
  const response = await requestJson<{ items: StoreOrder[] }>(
    `${getStoreApiBaseUrl()}/admin/orders`,
    {},
    accessToken
  );
  return response.items;
}
