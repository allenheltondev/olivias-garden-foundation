import type { Claim } from '../types/claim';

const CLAIM_SESSION_STORAGE_KEY = 'claim-session-v1';

function resolveClaimSessionStorageKey(viewerUserId?: string): string {
  return viewerUserId ? `${CLAIM_SESSION_STORAGE_KEY}:${viewerUserId}` : CLAIM_SESSION_STORAGE_KEY;
}

function parseClaims(serialized: string | null): Claim[] {
  if (!serialized) {
    return [];
  }

  try {
    const parsed = JSON.parse(serialized);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isClaim);
  } catch {
    return [];
  }
}

function isClaim(value: unknown): value is Claim {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.listingId === 'string' &&
    typeof record.claimerId === 'string' &&
    typeof record.listingOwnerId === 'string' &&
    typeof record.status === 'string'
  );
}

export function loadSessionClaims(viewerUserId?: string): Claim[] {
  const scopedKey = resolveClaimSessionStorageKey(viewerUserId);
  const scopedClaims = parseClaims(window.localStorage.getItem(scopedKey));
  if (scopedClaims.length > 0 || !viewerUserId) {
    return scopedClaims;
  }

  // Backward-compatible fallback to the legacy unscoped key.
  const legacyClaims = parseClaims(window.localStorage.getItem(CLAIM_SESSION_STORAGE_KEY));
  if (legacyClaims.length > 0) {
    saveSessionClaims(legacyClaims, viewerUserId);
  }

  return legacyClaims;
}

export function saveSessionClaims(claims: Claim[], viewerUserId?: string): void {
  try {
    const key = resolveClaimSessionStorageKey(viewerUserId);
    window.localStorage.setItem(key, JSON.stringify(claims));
  } catch {
    // Ignore localStorage write failures in restricted environments.
  }
}

export function upsertSessionClaim(existing: Claim[], claim: Claim): Claim[] {
  const index = existing.findIndex((candidate) => candidate.id === claim.id);
  if (index < 0) {
    return [claim, ...existing];
  }

  const next = [...existing];
  next[index] = claim;
  return next;
}
