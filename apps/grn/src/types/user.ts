/**
 * User tier levels in the platform
 */
export type UserTier = 'free' | 'supporter' | 'pro';

/**
 * User type indicating participation mode
 */
export type UserType = 'grower' | 'gatherer';

/**
 * Grower-specific profile information
 */
export interface GrowerProfile {
  homeZone: string;
  address: string;
  geoKey: string;
  lat?: number;
  lng?: number;
  shareRadiusMiles: number;
  isOrganization: boolean;
  organizationName?: string;
  units: 'metric' | 'imperial';
  locale: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Gatherer-specific profile information
 */
export interface GathererProfile {
  address: string;
  geoKey: string;
  lat: number;
  lng: number;
  searchRadiusMiles: number;
  organizationAffiliation?: string;
  units: 'metric' | 'imperial';
  locale: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * User profile information returned from the API
 * Matches the backend UserProfile model
 */
export interface UserProfile {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  tier: UserTier;
  userType: UserType | null;
  onboardingCompleted: boolean;
  growerProfile?: GrowerProfile | null;
  gathererProfile?: GathererProfile | null;
}
