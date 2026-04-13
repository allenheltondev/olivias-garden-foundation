import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RequireAuth } from './RequireAuth';
import * as useAuthModule from '../../hooks/useAuth';

vi.mock('../../hooks/useAuth');

describe('RequireAuth', () => {
  const mockUseAuth = vi.mocked(useAuthModule.useAuth);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state while checking authentication', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
      user: null,
      error: null,
      signIn: vi.fn(),
      signOut: vi.fn(),
      clearError: vi.fn(),
      refreshAuth: vi.fn(),
    });

    render(
      <RequireAuth>
        <div>Protected Content</div>
      </RequireAuth>
    );

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(screen.queryByText(/protected content/i)).not.toBeInTheDocument();
  });

  it('renders children when authenticated', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      user: { userId: '123', username: 'test@example.com' },
      error: null,
      signIn: vi.fn(),
      signOut: vi.fn(),
      clearError: vi.fn(),
      refreshAuth: vi.fn(),
    });

    render(
      <RequireAuth>
        <div>Protected Content</div>
      </RequireAuth>
    );

    expect(screen.getByText(/protected content/i)).toBeInTheDocument();
  });

  it('does not render children when not authenticated', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      user: null,
      error: null,
      signIn: vi.fn(),
      signOut: vi.fn(),
      clearError: vi.fn(),
      refreshAuth: vi.fn(),
    });

    render(
      <RequireAuth>
        <div>Protected Content</div>
      </RequireAuth>
    );

    expect(screen.queryByText(/protected content/i)).not.toBeInTheDocument();
  });

  it('renders fallback when not authenticated and fallback provided', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      user: null,
      error: null,
      signIn: vi.fn(),
      signOut: vi.fn(),
      clearError: vi.fn(),
      refreshAuth: vi.fn(),
    });

    render(
      <RequireAuth fallback={<div>Please sign in</div>}>
        <div>Protected Content</div>
      </RequireAuth>
    );

    expect(screen.getByText(/please sign in/i)).toBeInTheDocument();
    expect(screen.queryByText(/protected content/i)).not.toBeInTheDocument();
  });

  it('transitions from loading to authenticated state', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
      user: null,
      error: null,
      signIn: vi.fn(),
      signOut: vi.fn(),
      clearError: vi.fn(),
      refreshAuth: vi.fn(),
    });

    const { rerender } = render(
      <RequireAuth>
        <div>Protected Content</div>
      </RequireAuth>
    );

    expect(screen.getByText(/loading/i)).toBeInTheDocument();

    // Simulate auth state resolving
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      user: { userId: '123', username: 'test@example.com' },
      error: null,
      signIn: vi.fn(),
      signOut: vi.fn(),
      clearError: vi.fn(),
      refreshAuth: vi.fn(),
    });

    rerender(
      <RequireAuth>
        <div>Protected Content</div>
      </RequireAuth>
    );

    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    expect(screen.getByText(/protected content/i)).toBeInTheDocument();
  });

  it('transitions from loading to unauthenticated state', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
      user: null,
      error: null,
      signIn: vi.fn(),
      signOut: vi.fn(),
      clearError: vi.fn(),
      refreshAuth: vi.fn(),
    });

    const { rerender } = render(
      <RequireAuth>
        <div>Protected Content</div>
      </RequireAuth>
    );

    expect(screen.getByText(/loading/i)).toBeInTheDocument();

    // Simulate auth state resolving to unauthenticated
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      user: null,
      error: null,
      signIn: vi.fn(),
      signOut: vi.fn(),
      clearError: vi.fn(),
      refreshAuth: vi.fn(),
    });

    rerender(
      <RequireAuth>
        <div>Protected Content</div>
      </RequireAuth>
    );

    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/protected content/i)).not.toBeInTheDocument();
  });
});
