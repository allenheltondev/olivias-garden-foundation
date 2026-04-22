import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockFetchContributorProfileFromAccessToken,
  mockGetAccessVerifier,
  mockGetBearerToken,
  mockGetCognitoGroups,
  mockGetIdVerifier,
  mockGetRequiredAdminGroup,
  mockHasRequiredAdminGroup
} = vi.hoisted(() => ({
  mockFetchContributorProfileFromAccessToken: vi.fn(),
  mockGetAccessVerifier: vi.fn(),
  mockGetBearerToken: vi.fn(),
  mockGetCognitoGroups: vi.fn(),
  mockGetIdVerifier: vi.fn(),
  mockGetRequiredAdminGroup: vi.fn(() => 'admin'),
  mockHasRequiredAdminGroup: vi.fn()
}));

vi.mock('../../src/services/cognito-auth.mjs', () => ({
  fetchContributorProfileFromAccessToken: mockFetchContributorProfileFromAccessToken,
  getAccessVerifier: mockGetAccessVerifier,
  getBearerToken: mockGetBearerToken,
  getCognitoGroups: mockGetCognitoGroups,
  getIdVerifier: mockGetIdVerifier,
  getRequiredAdminGroup: mockGetRequiredAdminGroup,
  hasRequiredAdminGroup: mockHasRequiredAdminGroup
}));

import { requireAdminAccess, resolveOptionalContributor } from '../../src/services/auth.mjs';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetBearerToken.mockReturnValue(null);
  mockGetIdVerifier.mockReturnValue({ verify: vi.fn() });
  mockGetAccessVerifier.mockReturnValue({ verify: vi.fn() });
  mockGetCognitoGroups.mockReturnValue(['admin']);
  mockHasRequiredAdminGroup.mockReturnValue(true);
});

describe('resolveOptionalContributor', () => {
  it('returns null contributor when Authorization header is absent', async () => {
    const result = await resolveOptionalContributor({ headers: {} });

    expect(result).toEqual({ ok: true, contributor: null });
    expect(mockGetBearerToken).toHaveBeenCalled();
  });

  it('extracts sub directly from a valid ID token', async () => {
    const verifyId = vi.fn().mockResolvedValue({
      sub: 'id-sub-123',
      email: 'okra@example.com',
      name: 'Okra Grower'
    });

    mockGetBearerToken.mockReturnValue('id-token');
    mockGetIdVerifier.mockReturnValue({ verify: verifyId });

    const result = await resolveOptionalContributor({
      headers: { Authorization: 'Bearer id-token' }
    });

    expect(result).toEqual({
      ok: true,
      contributor: {
        sub: 'id-sub-123',
        email: 'okra@example.com',
        name: 'Okra Grower'
      }
    });
  });

  it('falls back to the access token verifier and resolves sub from the access token path', async () => {
    const verifyId = vi.fn().mockRejectedValue(new Error('wrong token use'));
    const verifyAccess = vi.fn().mockResolvedValue({
      sub: 'access-sub-456',
      username: 'okra-user'
    });

    mockGetBearerToken.mockReturnValue('access-token');
    mockGetIdVerifier.mockReturnValue({ verify: verifyId });
    mockGetAccessVerifier.mockReturnValue({ verify: verifyAccess });
    mockFetchContributorProfileFromAccessToken.mockResolvedValue({
      sub: 'access-sub-456',
      email: 'okra@example.com',
      name: 'Okra Access Grower'
    });

    const result = await resolveOptionalContributor({
      headers: { Authorization: 'Bearer access-token' }
    });

    expect(mockFetchContributorProfileFromAccessToken).toHaveBeenCalledWith(
      'access-token',
      expect.objectContaining({ sub: 'access-sub-456' })
    );
    expect(result).toEqual({
      ok: true,
      contributor: {
        sub: 'access-sub-456',
        email: 'okra@example.com',
        name: 'Okra Access Grower'
      }
    });
  });

  it('returns 401 when the bearer token cannot be verified', async () => {
    const verifyId = vi.fn().mockRejectedValue(new Error('bad token'));
    const verifyAccess = vi.fn().mockRejectedValue(new Error('bad token'));

    mockGetBearerToken.mockReturnValue('bad-token');
    mockGetIdVerifier.mockReturnValue({ verify: verifyId });
    mockGetAccessVerifier.mockReturnValue({ verify: verifyAccess });

    const result = await resolveOptionalContributor({
      headers: { Authorization: 'Bearer bad-token' }
    });

    expect(result).toEqual({
      ok: false,
      statusCode: 401,
      body: { error: 'Unauthorized', message: 'Invalid bearer token' }
    });
  });
});

describe('requireAdminAccess', () => {
  it('reads the bearer token and passes through admin sub when the access token is valid', async () => {
    const verifyAccess = vi.fn().mockResolvedValue({
      sub: 'admin-sub-123',
      email: 'admin@example.com',
      'cognito:groups': ['admin']
    });

    mockGetBearerToken.mockReturnValue('admin-token');
    mockGetAccessVerifier.mockReturnValue({ verify: verifyAccess });

    const result = await requireAdminAccess({
      headers: { Authorization: 'Bearer admin-token' }
    });

    expect(result).toEqual({
      ok: true,
      payload: {
        sub: 'admin-sub-123',
        email: 'admin@example.com',
        'cognito:groups': ['admin']
      }
    });
  });
});
