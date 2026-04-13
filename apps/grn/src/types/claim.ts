export type ClaimStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';

export interface Claim {
  id: string;
  listingId: string;
  requestId: string | null;
  claimerId: string;
  listingOwnerId: string;
  quantityClaimed: string;
  status: ClaimStatus;
  notes: string | null;
  claimedAt: string;
  confirmedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

export interface CreateClaimPayload {
  listingId: string;
  requestId?: string;
  quantityClaimed: number;
  notes?: string;
}

export interface TransitionClaimPayload {
  status: ClaimStatus;
  notes?: string;
}
