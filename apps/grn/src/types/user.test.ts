import { describe, it, expect } from 'vitest';
import type { UserType, UserProfile, GrowerProfile, GathererProfile } from './user';

describe('User Types', () => {
  describe('UserType', () => {
    it('should accept valid user types', () => {
      const grower: UserType = 'grower';
      const gatherer: UserType = 'gatherer';

      expect(grower).toBe('grower');
      expect(gatherer).toBe('gatherer');
    });
  });

  describe('GrowerProfile', () => {
    it('should accept valid grower profile', () => {
      const profile: GrowerProfile = {
        homeZone: '8a',
        address: '123 Main St, Springfield, IL',
        geoKey: '9q8yy9',
        lat: 37.7749,
        lng: -122.4194,
        shareRadiusMiles: 5.0,
        units: 'imperial',
        locale: 'en-US',
      };

      expect(profile.homeZone).toBe('8a');
      expect(profile.shareRadiusMiles).toBe(5.0);
      expect(profile.units).toBe('imperial');
    });

    it('should accept optional timestamp fields', () => {
      const profile: GrowerProfile = {
        homeZone: '8a',
        address: '123 Main St, Springfield, IL',
        geoKey: '9q8yy9',
        lat: 37.7749,
        lng: -122.4194,
        shareRadiusMiles: 5.0,
        units: 'metric',
        locale: 'en-US',
        createdAt: '2024-01-15T10:30:00Z',
        updatedAt: '2024-01-15T10:30:00Z',
      };

      expect(profile.createdAt).toBeDefined();
      expect(profile.updatedAt).toBeDefined();
    });
  });

  describe('GathererProfile', () => {
    it('should accept valid gatherer profile', () => {
      const profile: GathererProfile = {
        address: '456 Oak Ave, Springfield, IL',
        geoKey: '9q8yy9',
        lat: 37.7749,
        lng: -122.4194,
        searchRadiusMiles: 10.0,
        units: 'metric',
        locale: 'en-US',
      };

      expect(profile.searchRadiusMiles).toBe(10.0);
      expect(profile.units).toBe('metric');
    });

    it('should accept optional organization affiliation', () => {
      const profile: GathererProfile = {
        address: '456 Oak Ave, Springfield, IL',
        geoKey: '9q8yy9',
        lat: 37.7749,
        lng: -122.4194,
        searchRadiusMiles: 10.0,
        organizationAffiliation: 'SF Food Bank',
        units: 'metric',
        locale: 'en-US',
      };

      expect(profile.organizationAffiliation).toBe('SF Food Bank');
    });
  });

  describe('UserProfile', () => {
    it('should accept user with no onboarding', () => {
      const user: UserProfile = {
        userId: 'test-uuid',
        email: 'test@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
        tier: 'free',
        userType: null,
        onboardingCompleted: false,
      };

      expect(user.userType).toBeNull();
      expect(user.onboardingCompleted).toBe(false);
    });

    it('should accept grower user with profile', () => {
      const user: UserProfile = {
        userId: 'test-uuid',
        email: 'grower@example.com',
        firstName: 'John',
        lastName: 'Grower',
        tier: 'free',
        userType: 'grower',
        onboardingCompleted: true,
        growerProfile: {
          homeZone: '8a',
          address: '123 Main St, Springfield, IL',
          geoKey: '9q8yy9',
          lat: 37.7749,
          lng: -122.4194,
          shareRadiusMiles: 5.0,
          units: 'imperial',
          locale: 'en-US',
        },
      };

      expect(user.userType).toBe('grower');
      expect(user.growerProfile).toBeDefined();
      expect(user.growerProfile?.homeZone).toBe('8a');
    });

    it('should accept gatherer user with profile', () => {
      const user: UserProfile = {
        userId: 'test-uuid',
        email: 'gatherer@example.com',
        firstName: 'Jane',
        lastName: 'Gatherer',
        tier: 'supporter',
        userType: 'gatherer',
        onboardingCompleted: true,
        gathererProfile: {
          address: '456 Oak Ave, Springfield, IL',
          geoKey: '9q8yy9',
          lat: 37.7749,
          lng: -122.4194,
          searchRadiusMiles: 10.0,
          organizationAffiliation: 'Community Kitchen',
          units: 'metric',
          locale: 'en-US',
        },
      };

      expect(user.userType).toBe('gatherer');
      expect(user.gathererProfile).toBeDefined();
      expect(user.gathererProfile?.searchRadiusMiles).toBe(10.0);
    });
  });
});
