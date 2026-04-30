import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import * as useAuthModule from './hooks/useAuth';
import * as useUserModule from './hooks/useUser';

vi.mock('./hooks/useAuth');
vi.mock('./hooks/useUser');
vi.mock('./shell/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('./pages/DashboardPage', () => ({
  DashboardPage: () => <div>Profile View</div>,
}));
vi.mock('./pages/CropsPage', () => ({ CropsPage: () => <div /> }));
vi.mock('./pages/ListingsPage', () => ({ ListingsPage: () => <div /> }));
vi.mock('./pages/RequestsPage', () => ({ RequestsPage: () => <div /> }));
vi.mock('./pages/RemindersPage', () => ({ RemindersPage: () => <div /> }));
vi.mock('./components/Onboarding/OnboardingGuard', () => ({
  OnboardingGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('App', () => {
  const mockUseAuth = vi.mocked(useAuthModule.useAuth);
  const mockUseUser = vi.mocked(useUserModule.useUser);
  const assignSpy = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock window.location.assign for redirect testing
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, assign: assignSpy, href: 'https://goodroots.network/' },
    });

    mockUseUser.mockReturnValue({
      user: null,
      isLoading: false,
      error: null,
      refreshUser: vi.fn(),
      clearError: vi.fn(),
    });

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
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
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('redirects to foundation login when not authenticated', () => {
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
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    expect(assignSpy).toHaveBeenCalledTimes(1);
    const redirectUrl = assignSpy.mock.calls[0][0] as string;
    expect(redirectUrl).toContain('/login');
    expect(redirectUrl).toContain('redirect=');
    expect(redirectUrl).toContain(encodeURIComponent('https://goodroots.network/'));
  });

  it('shows profile view when authenticated', async () => {
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

    mockUseUser.mockReturnValue({
      user: {
        userId: '123',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        tier: 'free',
        userType: 'grower',
        onboardingCompleted: true,
        growerProfile: null,
        gathererProfile: null,
      },
      isLoading: false,
      error: null,
      refreshUser: vi.fn(),
      clearError: vi.fn(),
    });

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText(/profile view/i)).toBeInTheDocument();
    expect(assignSpy).not.toHaveBeenCalled();
  });
});
