import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useOnboarding } from './useOnboarding';
import * as api from '../services/api';

vi.mock('../services/api');

vi.mock('../utils/logging', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('useOnboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('submitGrowerProfile', () => {
    it('submits grower profile with address', async () => {
      const profileInput = {
        homeZone: '8a',
        address: '123 Main St, Springfield, IL',
        shareRadiusMiles: 5.0,
        isOrganization: false,
        organizationName: undefined,
        units: 'imperial' as const,
        locale: 'en-US',
      };

      vi.mocked(api.updateMe).mockResolvedValue(undefined);

      const { result } = renderHook(() => useOnboarding());

      await act(async () => {
        await result.current.submitGrowerProfile(profileInput);
      });

      expect(api.updateMe).toHaveBeenCalledWith({
        userType: 'grower',
        growerProfile: profileInput,
      });
    });

    it('submits organization grower profile details', async () => {
      const profileInput = {
        homeZone: '8a',
        address: '800 Community Garden Way, Austin, TX 78701',
        shareRadiusMiles: 12.0,
        isOrganization: true,
        organizationName: 'North Austin Community Garden',
        units: 'imperial' as const,
        locale: 'en-US',
      };

      vi.mocked(api.updateMe).mockResolvedValue(undefined);

      const { result } = renderHook(() => useOnboarding());

      await act(async () => {
        await result.current.submitGrowerProfile(profileInput);
      });

      expect(api.updateMe).toHaveBeenCalledWith({
        userType: 'grower',
        growerProfile: profileInput,
      });
    });
  });

  describe('submitGathererProfile', () => {
    it('submits gatherer profile with address', async () => {
      const profileInput = {
        address: '456 Oak Ave, Springfield, IL',
        searchRadiusMiles: 10.0,
        organizationAffiliation: 'SF Food Bank',
        units: 'metric' as const,
        locale: 'en-US',
      };

      vi.mocked(api.updateMe).mockResolvedValue(undefined);

      const { result } = renderHook(() => useOnboarding());

      await act(async () => {
        await result.current.submitGathererProfile(profileInput);
      });

      expect(api.updateMe).toHaveBeenCalledWith({
        userType: 'gatherer',
        gathererProfile: profileInput,
      });
    });
  });
});
