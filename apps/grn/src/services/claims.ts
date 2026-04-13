import apiFetch from './api';
import type { Claim, CreateClaimPayload, TransitionClaimPayload } from '../types/claim';

interface RawClaimResponse {
  id: string;
  listingId?: string;
  listing_id?: string;
  requestId?: string | null;
  request_id?: string | null;
  claimerId?: string;
  claimer_id?: string;
  listingOwnerId?: string;
  listing_owner_id?: string;
  quantityClaimed?: string;
  quantity_claimed?: string;
  status: Claim['status'];
  notes?: string | null;
  claimedAt?: string;
  claimed_at?: string;
  confirmedAt?: string | null;
  confirmed_at?: string | null;
  completedAt?: string | null;
  completed_at?: string | null;
  cancelledAt?: string | null;
  cancelled_at?: string | null;
}

function mapClaim(raw: RawClaimResponse): Claim {
  return {
    id: raw.id,
    listingId: raw.listingId ?? raw.listing_id ?? '',
    requestId: raw.requestId ?? raw.request_id ?? null,
    claimerId: raw.claimerId ?? raw.claimer_id ?? '',
    listingOwnerId: raw.listingOwnerId ?? raw.listing_owner_id ?? '',
    quantityClaimed: raw.quantityClaimed ?? raw.quantity_claimed ?? '0',
    status: raw.status,
    notes: raw.notes ?? null,
    claimedAt: raw.claimedAt ?? raw.claimed_at ?? '',
    confirmedAt: raw.confirmedAt ?? raw.confirmed_at ?? null,
    completedAt: raw.completedAt ?? raw.completed_at ?? null,
    cancelledAt: raw.cancelledAt ?? raw.cancelled_at ?? null,
  };
}

export async function createClaim(payload: CreateClaimPayload): Promise<Claim> {
  const response = await apiFetch<RawClaimResponse>('/claims', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return mapClaim(response);
}

export async function updateClaimStatus(
  claimId: string,
  payload: TransitionClaimPayload
): Promise<Claim> {
  const response = await apiFetch<RawClaimResponse>(`/claims/${claimId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });

  return mapClaim(response);
}
