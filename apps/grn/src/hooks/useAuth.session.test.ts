/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAuth } from './useAuth';
import * as auth from 'aws-amplify/auth';

vi.mock('aws-amplify/auth', () => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  getCurrentUser: vi.fn(),
  fetchAuthSession: vi.fn(),
}));

describe('useAuth - Session Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Session Persistence', () => {
    it('restores session on mount when user is authenticated', async () => {
      const mockUser = { userId: '123', username: 'test@example.com' };
      vi.mocked(auth.getCurrentUser).mockResolvedValue(mockUser);
      vi.mocked(auth.fetchAuthSession).mockResolvedValue({
        tokens: { accessToken: { toString: () => 'token' } },
      } as any);

      const { result } = renderHook(() => useAuth());

      expect(result.current.isLoading).toBe(true);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.user).toEqual(mockUser);
    });

    it('handles invalid session on mount', async () => {
      vi.mocked(auth.getCurrentUser).mockRejectedValue(new Error('Not authenticated'));

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
    });

    it('clears session on signOut', async () => {
      const mockUser = { userId: '123', username: 'test@example.com' };
      vi.mocked(auth.getCurrentUser).mockResolvedValue(mockUser);
      vi.mocked(auth.fetchAuthSession).mockResolvedValue({
        tokens: { accessToken: { toString: () => 'token' } },
      } as any);
      vi.mocked(auth.signOut).mockResolvedValue();

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });

      await act(async () => {
        await result.current.signOut();
      });

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
      expect(auth.signOut).toHaveBeenCalled();
    });
  });

  describe('Cross-Tab Logout', () => {
    it('detects logout in another tab via storage event', async () => {
      const mockUser = { userId: '123', username: 'test@example.com' };
      vi.mocked(auth.getCurrentUser).mockResolvedValue(mockUser);
      vi.mocked(auth.fetchAuthSession).mockResolvedValue({
        tokens: { accessToken: { toString: () => 'token' } },
      } as any);

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });

      // Simulate storage event (logout in another tab)
      act(() => {
        const storageEvent = new StorageEvent('storage', {
          key: 'CognitoIdentityServiceProvider.test.accessToken',
          newValue: null,
          oldValue: 'some-token-value',
        });
        window.dispatchEvent(storageEvent);
      });

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(false);
      });

      expect(result.current.user).toBeNull();
    });

    it('ignores storage events for non-auth keys', async () => {
      const mockUser = { userId: '123', username: 'test@example.com' };
      vi.mocked(auth.getCurrentUser).mockResolvedValue(mockUser);
      vi.mocked(auth.fetchAuthSession).mockResolvedValue({
        tokens: { accessToken: { toString: () => 'token' } },
      } as any);

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });

      // Simulate storage event for unrelated key
      act(() => {
        const storageEvent = new StorageEvent('storage', {
          key: 'some-other-key',
          newValue: null,
          oldValue: 'value',
        });
        window.dispatchEvent(storageEvent);
      });

      // Should remain authenticated
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.user).toEqual(mockUser);
    });

    it('re-checks auth state when tab becomes visible', async () => {
      const mockUser = { userId: '123', username: 'test@example.com' };
      vi.mocked(auth.getCurrentUser).mockResolvedValue(mockUser);
      vi.mocked(auth.fetchAuthSession).mockResolvedValue({
        tokens: { accessToken: { toString: () => 'token' } },
      } as any);

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });

      const initialCallCount = vi.mocked(auth.getCurrentUser).mock.calls.length;

      // Simulate tab becoming visible
      Object.defineProperty(document, 'visibilityState', {
        writable: true,
        configurable: true,
        value: 'visible',
      });

      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });

      await waitFor(() => {
        expect(vi.mocked(auth.getCurrentUser).mock.calls.length).toBeGreaterThan(initialCallCount);
      });
    });
  });

  describe('Session Invalidation', () => {
    it('handles expired session', async () => {
      const mockUser = { userId: '123', username: 'test@example.com' };
      vi.mocked(auth.getCurrentUser).mockResolvedValue(mockUser);
      vi.mocked(auth.fetchAuthSession).mockResolvedValue({
        tokens: { accessToken: { toString: () => 'token' } },
      } as any);

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });

      // Simulate session expiration
      vi.mocked(auth.getCurrentUser).mockRejectedValue(new Error('Session expired'));

      // Trigger auth check (simulating API call that detects expired session)
      act(() => {
        window.dispatchEvent(new Event('auth:unauthorized'));
      });

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(false);
      });

      expect(result.current.error?.message).toBe('Session expired');
    });

    it('refreshes auth state on demand', async () => {
      const mockUser = { userId: '123', username: 'test@example.com' };
      vi.mocked(auth.getCurrentUser).mockResolvedValue(mockUser);
      vi.mocked(auth.fetchAuthSession).mockResolvedValue({
        tokens: { accessToken: { toString: () => 'token' } },
      } as any);

      const { result } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });

      const initialCallCount = vi.mocked(auth.getCurrentUser).mock.calls.length;

      // Manually refresh auth state
      await act(async () => {
        await result.current.refreshAuth();
      });

      expect(vi.mocked(auth.getCurrentUser).mock.calls.length).toBeGreaterThan(initialCallCount);
    });
  });

  describe('Persistence Mode Behavior', () => {
    it('maintains authentication across hook remounts', async () => {
      const mockUser = { userId: '123', username: 'test@example.com' };
      vi.mocked(auth.getCurrentUser).mockResolvedValue(mockUser);
      vi.mocked(auth.fetchAuthSession).mockResolvedValue({
        tokens: { accessToken: { toString: () => 'token' } },
      } as any);

      // First mount
      const { result: result1, unmount } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result1.current.isAuthenticated).toBe(true);
      });

      unmount();

      // Second mount (simulating page reload)
      const { result: result2 } = renderHook(() => useAuth());

      await waitFor(() => {
        expect(result2.current.isAuthenticated).toBe(true);
      });

      expect(result2.current.user).toEqual(mockUser);
    });
  });
});
