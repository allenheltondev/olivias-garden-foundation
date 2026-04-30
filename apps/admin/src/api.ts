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
  variations: ProductVariation[];
  stripe_product_id: string;
  stripe_price_id: string;
  created_at: string;
  updated_at: string;
}

export interface ProductVariation {
  name: string;
  values: string[];
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
  variation_match: Record<string, string>;
  processing_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface OkraSubmission {
  id: string;
  contributor_name: string | null;
  contributor_email: string | null;
  story_text: string | null;
  raw_location_text: string | null;
  privacy_mode: string;
  display_lat: number | null;
  display_lng: number | null;
  status: string;
  created_at: string;
  photos: string[];
  photo_details?: {
    id: string;
    url: string;
    review_status: string;
    edit_action: 'add' | 'remove' | null;
  }[];
  review_kind?: 'submission' | 'edit';
  edit_id?: string | null;
  current_contributor_name?: string | null;
  current_story_text?: string | null;
  current_raw_location_text?: string | null;
  current_privacy_mode?: string | null;
  current_display_lat?: number | null;
  current_display_lng?: number | null;
}

export interface SeedRequestQueueItem {
  id: string;
  name: string | null;
  email: string | null;
  fulfillmentMethod: 'mail' | 'in_person' | null;
  shippingAddress: {
    line1?: string;
    line2?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country?: string;
  } | null;
  visitDetails: {
    approximateDate?: string;
    notes?: string;
  } | null;
  message: string | null;
  createdAt: string | null;
  requestStatus: 'open' | 'handled';
}

export interface AdminStats {
  userCount: number | null;
  openSeedRequestCount: number | null;
  pendingOkraCount: number | null;
}

export interface UpsertStoreProductRequest {
  slug: string;
  name: string;
  short_description: string | null;
  description: string | null;
  status: StoreProduct['status'];
  kind: StoreProduct['kind'];
  fulfillment_type: StoreProduct['fulfillment_type'];
  is_public: boolean;
  is_featured: boolean;
  currency: string;
  unit_amount_cents: number;
  image_url: string | null;
  images?: Array<{
    id: string;
    sort_order?: number;
    alt_text?: string | null;
    variation_match?: Record<string, string>;
  }>;
  metadata: Record<string, unknown>;
  variations?: ProductVariation[];
}

export interface StoreProductImageUploadIntent {
  imageId: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  s3Key: string;
  expiresInSeconds: number;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function getAdminApiBaseUrl(): string {
  const baseUrl = import.meta.env.VITE_ADMIN_API_URL;
  if (!baseUrl) {
    throw new Error('Missing VITE_ADMIN_API_URL for admin app.');
  }
  return trimTrailingSlash(baseUrl);
}

function getOkraAdminApiBaseUrl(): string {
  const baseUrl = import.meta.env.VITE_OKRA_ADMIN_API_URL;
  if (!baseUrl) {
    throw new Error('Missing VITE_OKRA_ADMIN_API_URL for admin app.');
  }
  return trimTrailingSlash(baseUrl);
}

function getStoreApiBaseUrl(): string {
  const baseUrl = import.meta.env.VITE_STORE_API_URL;
  if (!baseUrl) {
    throw new Error('Missing VITE_STORE_API_URL for admin app.');
  }
  return trimTrailingSlash(baseUrl);
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
  selectedVariations: Record<string, string> | null;
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
    name?: string | null;
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
    country?: string | null;
  } | null;
  items: StoreOrderItem[];
  createdAt: string;
  paidAt: string | null;
}

async function requestJson<T>(url: string, accessToken: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    let message = response.statusText;
    try {
      const payload = await response.json();
      message = payload.message || payload.error?.message || payload.error || message;
    } catch {
      // noop
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export async function listStoreProducts(accessToken: string): Promise<StoreProduct[]> {
  const response = await requestJson<{ items: StoreProduct[] }>(
    `${getAdminApiBaseUrl()}/admin/store/products`,
    accessToken
  );
  return response.items;
}

export async function createStoreProduct(
  accessToken: string,
  payload: UpsertStoreProductRequest
): Promise<StoreProduct> {
  return requestJson<StoreProduct>(`${getAdminApiBaseUrl()}/admin/store/products`, accessToken, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateStoreProduct(
  accessToken: string,
  productId: string,
  payload: UpsertStoreProductRequest
): Promise<StoreProduct> {
  return requestJson<StoreProduct>(
    `${getAdminApiBaseUrl()}/admin/store/products/${productId}`,
    accessToken,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    }
  );
}

export async function archiveStoreProduct(accessToken: string, productId: string): Promise<StoreProduct> {
  return requestJson<StoreProduct>(
    `${getAdminApiBaseUrl()}/admin/store/products/${productId}`,
    accessToken,
    { method: 'DELETE' }
  );
}

export async function createStoreProductImageUploadIntent(
  accessToken: string,
  contentType: string,
  contentLength: number
): Promise<StoreProductImageUploadIntent> {
  return requestJson<StoreProductImageUploadIntent>(
    `${getAdminApiBaseUrl()}/admin/store/product-images`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({ contentType, contentLength }),
    }
  );
}

export async function uploadStoreProductImage(
  accessToken: string,
  file: File
): Promise<{ imageId: string; status: 'processing' }> {
  const intent = await createStoreProductImageUploadIntent(accessToken, file.type, file.size);
  const upload = await fetch(intent.uploadUrl, {
    method: intent.method,
    headers: intent.headers,
    body: file,
  });

  if (!upload.ok) {
    throw new Error('Unable to upload product image.');
  }

  return requestJson<{ imageId: string; status: 'processing' }>(
    `${getAdminApiBaseUrl()}/admin/store/product-images/${intent.imageId}/complete`,
    accessToken,
    { method: 'POST', body: JSON.stringify({}) }
  );
}

export interface OkraReviewQueueResponse {
  data: OkraSubmission[];
  total: number;
}

export async function listOkraReviewQueue(accessToken: string): Promise<OkraReviewQueueResponse> {
  const response = await requestJson<{ data: OkraSubmission[]; total?: number }>(
    `${getOkraAdminApiBaseUrl()}/submissions?status=pending`,
    accessToken
  );
  return {
    data: response.data,
    total: response.total ?? response.data.length,
  };
}

export type OkraDenialReason = 'spam' | 'invalid_location' | 'inappropriate' | 'other';

export async function reviewOkraSubmission(
  accessToken: string,
  submissionId: string,
  payload:
    | { status: 'approved'; review_notes?: string; target_edit_id?: string }
    | { status: 'denied'; reason: OkraDenialReason; review_notes?: string; target_edit_id?: string }
): Promise<void> {
  await requestJson(
    `${getOkraAdminApiBaseUrl()}/submissions/${submissionId}/statuses`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
}

export interface SeedRequestQueueResponse {
  data: SeedRequestQueueItem[];
  total: number;
  page: number;
  limit: number;
}

export async function listSeedRequestQueue(
  accessToken: string,
  options: { page?: number; limit?: number } = {}
): Promise<SeedRequestQueueResponse> {
  const page = options.page ?? 1;
  const limit = options.limit ?? 20;
  const url = `${getOkraAdminApiBaseUrl()}/requests?status=open&page=${page}&limit=${limit}`;
  const response = await requestJson<{
    data: SeedRequestQueueItem[];
    total?: number;
    page?: number;
    limit?: number;
  }>(url, accessToken);
  return {
    data: response.data,
    total: response.total ?? response.data.length,
    page: response.page ?? page,
    limit: response.limit ?? limit,
  };
}

export async function markSeedRequestHandled(
  accessToken: string,
  requestId: string,
  payload: { status: 'handled'; review_notes?: string }
): Promise<void> {
  await requestJson(
    `${getOkraAdminApiBaseUrl()}/requests/${requestId}/statuses`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
}

export async function getAdminStats(accessToken: string): Promise<AdminStats> {
  return requestJson<AdminStats>(
    `${getOkraAdminApiBaseUrl()}/stats`,
    accessToken
  );
}

export async function listStoreOrders(accessToken: string): Promise<StoreOrder[]> {
  const response = await requestJson<{ items: StoreOrder[] }>(
    `${getStoreApiBaseUrl()}/admin/orders`,
    accessToken
  );
  return response.items;
}

export type ActivityEventType =
  | 'submission.created'
  | 'seed-request.created'
  | 'donation.completed'
  | 'user.signed-up'
  | 'org-inquiry.received'
  | 'general-inquiry.received';

export interface ActivityEvent {
  eventId: string;
  source: string;
  detailType: ActivityEventType | string;
  occurredAt: string;
  summary: string | null;
  data: Record<string, unknown>;
}

export interface ActivityFeedResponse {
  items: ActivityEvent[];
  nextCursor: string | null;
}

export async function listActivity(
  accessToken: string,
  options: { cursor?: string; limit?: number; detailType?: string } = {}
): Promise<ActivityFeedResponse> {
  const params = new URLSearchParams();
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.detailType) params.set('detailType', options.detailType);
  const search = params.toString();
  const url = `${getAdminApiBaseUrl()}/admin/activity${search ? `?${search}` : ''}`;
  return requestJson<ActivityFeedResponse>(url, accessToken);
}

export interface FinanceBucket {
  periodStart: string;
  totalCents: number;
  donationOneTimeCents: number;
  donationRecurringCents: number;
  merchandiseCents: number;
}

export interface FinanceTotals {
  totalCents: number;
  donationOneTimeCents: number;
  donationRecurringCents: number;
  merchandiseCents: number;
}

export interface FinanceRevenueResponse {
  range: { from: string; to: string; granularity: 'day' | 'week' | 'month' };
  totals: FinanceTotals;
  buckets: FinanceBucket[];
}

export async function getFinanceRevenue(
  accessToken: string,
  options: { from?: string; to?: string; granularity?: 'day' | 'week' | 'month' } = {}
): Promise<FinanceRevenueResponse> {
  const params = new URLSearchParams();
  if (options.from) params.set('from', options.from);
  if (options.to) params.set('to', options.to);
  if (options.granularity) params.set('granularity', options.granularity);
  const search = params.toString();
  const url = `${getAdminApiBaseUrl()}/admin/finance/revenue${search ? `?${search}` : ''}`;
  return requestJson<FinanceRevenueResponse>(url, accessToken);
}
