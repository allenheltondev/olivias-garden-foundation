import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import * as useAuthModule from './hooks/useAuth';
import * as useUserModule from './hooks/useUser';

vi.mock('./hooks/useAuth');
vi.mock('./hooks/useUser');
vi.mock('./components/Profile/ProfileView', () => ({
  ProfileView: () => <div>Profile View</div>,
}));

describe('App', () => {
  const mockUseAuth = vi.mocked(useAuthModule.useAuth);
  const mockUseUser = vi.mocked(useUserModule.useUser);

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock for useUser
    mockUseUser.mockReturnValue({
      user: null,
      isLoading: false,
      error: null,
      refreshUser: vi.fn(),
      clearError: vi.fn(),
    });

    // Mock matchMedia for PlantLoader
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

    render(<App />);

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows login page when not authenticated', async () => {
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

    render(<App />);

    expect(await screen.findByText(/good roots network/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
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

    render(<App />);

    expect(await screen.findByText(/profile view/i)).toBeInTheDocument();
  });

  it('navigates to signup page', async () => {
    const user = userEvent.setup();
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

    render(<App />);

    expect(await screen.findByText(/good roots network/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /sign up/i }));

    expect(await screen.findByText(/already have an account/i)).toBeInTheDocument();
  });

  it('navigates to forgot password page', async () => {
    const user = userEvent.setup();
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

    render(<App />);

    expect(await screen.findByText(/good roots network/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /forgot your password/i }));

    expect(await screen.findByText(/we'll help you get back into your account/i)).toBeInTheDocument();
  });

  it('navigates back to login from signup', async () => {
    const user = userEvent.setup();
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

    render(<App />);

    // Navigate to signup
    await user.click(screen.getByRole('button', { name: /sign up/i }));
    expect(await screen.findByText(/already have an account/i)).toBeInTheDocument();

    // Navigate back to login
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText(/good roots network/i)).toBeInTheDocument();
  });

  it('navigates back to login from forgot password', async () => {
    const user = userEvent.setup();
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

    render(<App />);

    // Navigate to forgot password
    await user.click(screen.getByRole('button', { name: /forgot your password/i }));
    expect(screen.getByText(/we'll help you get back into your account/i)).toBeInTheDocument();

    // Navigate back to login
    await user.click(screen.getByRole('button', { name: /back to login/i }));
    expect(await screen.findByText(/good roots network/i)).toBeInTheDocument();
  });

  it('prevents access to protected content when not authenticated', async () => {
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

    render(<App />);

    // Should show login page, not profile
    expect(await screen.findByText(/good roots network/i)).toBeInTheDocument();
    expect(screen.queryByText(/profile view/i)).not.toBeInTheDocument();
  });

  it('transitions from unauthenticated to authenticated', async () => {
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

    const { rerender } = render(<App />);

    expect(await screen.findByText(/good roots network/i)).toBeInTheDocument();

    // Simulate successful authentication
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

    rerender(<App />);

    expect(screen.queryByText(/good roots network/i)).not.toBeInTheDocument();
    expect(await screen.findByText(/profile view/i)).toBeInTheDocument();
  });
});






