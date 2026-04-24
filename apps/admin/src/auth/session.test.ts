import { describe, expect, it, vi } from 'vitest';
import { loadAdminSession } from './session';

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: vi.fn(async () => ({ userId: '1' })),
  fetchAuthSession: vi.fn(async () => ({
    tokens: {
      accessToken: {
        toString: () => 'token',
        payload: {
          email: 'admin@example.com',
          'cognito:groups': ['admin'],
        },
      },
      idToken: {
        payload: {
          name: 'Admin User',
        },
      },
    },
  })),
}));

describe('loadAdminSession', () => {
  it('returns an admin session when cognito groups include admin', async () => {
    const session = await loadAdminSession();
    expect(session).not.toBeNull();
    expect(session?.isAdmin).toBe(true);
    expect(session?.email).toBe('admin@example.com');
    expect(session?.displayName).toBe('Admin User');
  });
});
