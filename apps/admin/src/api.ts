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
  metadata: Record<string, unknown>;
  stripe_product_id: string;
  stripe_price_id: string;
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
  status: string;
  created_at: string;
  photos: string[];
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
  statement_descriptor: string | null;
  nonprofit_program: string | null;
  impact_summary: string | null;
  image_url: string | null;
  metadata: Record<string, unknown>;
}

function getAdminApiBaseUrl(): string {
  const baseUrl = import.meta.env.VITE_ADMIN_API_URL;
  if (!baseUrl) {
    throw new Error('Missing VITE_ADMIN_API_URL for admin app.');
  }
  return baseUrl;
}

function getOkraAdminApiBaseUrl(): string {
  const baseUrl = import.meta.env.VITE_OKRA_ADMIN_API_URL;
  if (!baseUrl) {
    throw new Error('Missing VITE_OKRA_ADMIN_API_URL for admin app.');
  }
  return baseUrl;
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
      message = payload.message || payload.error || message;
    } catch {
      // noop
    }
    throw new Error(message);
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

export async function listOkraReviewQueue(accessToken: string): Promise<OkraSubmission[]> {
  const response = await requestJson<{ data: OkraSubmission[] }>(
    `${getOkraAdminApiBaseUrl()}/submissions/review-queue`,
    accessToken
  );
  return response.data;
}

export async function reviewOkraSubmission(
  accessToken: string,
  submissionId: string,
  payload:
    | { status: 'approved'; review_notes?: string }
    | { status: 'denied'; reason: 'spam' | 'invalid_location' | 'inappropriate' | 'other'; review_notes?: string }
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
