import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginForm } from './LoginForm';
import * as auth from 'aws-amplify/auth';

vi.mock('aws-amplify/auth', () => ({
  signIn: vi.fn(),
}));

describe('LoginForm', () => {
  const mockOnSuccess = vi.fn();
  const mockOnUnverified = vi.fn();
  const mockOnError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all form fields', () => {
    render(
      <LoginForm
        onSuccess={mockOnSuccess}
        onUnverified={mockOnUnverified}
      />
    );

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('validates email format', async () => {
    const user = userEvent.setup();
    render(
      <LoginForm
        onSuccess={mockOnSuccess}
        onUnverified={mockOnUnverified}
      />
    );

    const emailInput = screen.getByLabelText(/email/i);
    await user.type(emailInput, 'invalid-email');
    await user.tab();

    await waitFor(() => {
      expect(screen.getByText(/please enter a valid email address/i)).toBeInTheDocument();
    });
  });

  it('requires password field', async () => {
    const user = userEvent.setup();
    render(
      <LoginForm
        onSuccess={mockOnSuccess}
        onUnverified={mockOnUnverified}
      />
    );

    const passwordInput = screen.getByLabelText(/^password$/i);
    await user.click(passwordInput);
    // Type something then delete it to trigger validation
    await user.type(passwordInput, 'a');
    await user.clear(passwordInput);

    await waitFor(() => {
      expect(screen.getByText(/password is required/i)).toBeInTheDocument();
    });
  });

  it('submits form with valid credentials', async () => {
    const user = userEvent.setup();
    vi.mocked(auth.signIn).mockResolvedValueOnce({
      isSignedIn: true,
      nextStep: { signInStep: 'DONE' },
    });

    render(
      <LoginForm
        onSuccess={mockOnSuccess}
        onUnverified={mockOnUnverified}
      />
    );

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'Password123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(auth.signIn).toHaveBeenCalledWith({
        username: 'test@example.com',
        password: 'Password123',
      });
      expect(mockOnSuccess).toHaveBeenCalled();
    });
  });

  it('displays error for invalid credentials', async () => {
    const user = userEvent.setup();
    const error = new Error('Incorrect username or password');
    error.name = 'NotAuthorizedException';
    vi.mocked(auth.signIn).mockRejectedValueOnce(error);

    render(
      <LoginForm
        onSuccess={mockOnSuccess}
        onUnverified={mockOnUnverified}
        onError={mockOnError}
      />
    );

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'WrongPassword');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/invalid email or password/i)).toBeInTheDocument();
      expect(mockOnError).toHaveBeenCalledWith(error);
    });
  });

  it('handles unverified account by calling onUnverified', async () => {
    const user = userEvent.setup();
    const error = new Error('User is not confirmed');
    error.name = 'UserNotConfirmedException';
    vi.mocked(auth.signIn).mockRejectedValueOnce(error);

    render(
      <LoginForm
        onSuccess={mockOnSuccess}
        onUnverified={mockOnUnverified}
      />
    );

    await user.type(screen.getByLabelText(/email/i), 'unverified@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'Password123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(mockOnUnverified).toHaveBeenCalledWith('unverified@example.com');
      expect(mockOnSuccess).not.toHaveBeenCalled();
    });
  });

  it('does not reveal account existence for non-existent user', async () => {
    const user = userEvent.setup();
    const error = new Error('User does not exist');
    error.name = 'UserNotFoundException';
    vi.mocked(auth.signIn).mockRejectedValueOnce(error);

    render(
      <LoginForm
        onSuccess={mockOnSuccess}
        onUnverified={mockOnUnverified}
        onError={mockOnError}
      />
    );

    await user.type(screen.getByLabelText(/email/i), 'nonexistent@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'Password123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      // Should show same message as invalid credentials
      expect(screen.getByText(/invalid email or password/i)).toBeInTheDocument();
      expect(mockOnError).toHaveBeenCalledWith(error);
    });
  });

  it('shows loading state during submission', async () => {
    const user = userEvent.setup();
    vi.mocked(auth.signIn).mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100))
    );

    render(
      <LoginForm
        onSuccess={mockOnSuccess}
        onUnverified={mockOnUnverified}
      />
    );

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'Password123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/signing in/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled();
  });

  it('displays network error message', async () => {
    const user = userEvent.setup();
    const error = new Error('Network error');
    vi.mocked(auth.signIn).mockRejectedValueOnce(error);

    render(
      <LoginForm
        onSuccess={mockOnSuccess}
        onUnverified={mockOnUnverified}
      />
    );

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'Password123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/unable to connect/i)).toBeInTheDocument();
    });
  });
});

