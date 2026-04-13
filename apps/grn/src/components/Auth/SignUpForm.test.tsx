import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignUpForm } from './SignUpForm';
import * as auth from 'aws-amplify/auth';

vi.mock('aws-amplify/auth', () => ({
  signUp: vi.fn(),
}));

describe('SignUpForm', () => {
  const mockOnSuccess = vi.fn();
  const mockOnError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all form fields', () => {
    render(<SignUpForm onSuccess={mockOnSuccess} />);

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign up/i })).toBeInTheDocument();
  });

  it('validates email format', async () => {
    const user = userEvent.setup();
    render(<SignUpForm onSuccess={mockOnSuccess} />);

    const emailInput = screen.getByLabelText(/email/i);
    await user.type(emailInput, 'invalid-email');
    await user.tab();

    await waitFor(() => {
      expect(screen.getByText(/please enter a valid email address/i)).toBeInTheDocument();
    });
  });

  it('validates password requirements', async () => {
    const user = userEvent.setup();
    render(<SignUpForm onSuccess={mockOnSuccess} />);

    const passwordInput = screen.getByLabelText(/^password$/i);
    await user.type(passwordInput, 'weak');
    await user.tab();

    await waitFor(() => {
      expect(screen.getByText(/password must be at least 8 characters/i)).toBeInTheDocument();
    });
  });

  it('validates password confirmation match', async () => {
    const user = userEvent.setup();
    render(<SignUpForm onSuccess={mockOnSuccess} />);

    const passwordInput = screen.getByLabelText(/^password$/i);
    const confirmInput = screen.getByLabelText(/confirm password/i);

    await user.type(passwordInput, 'Password123');
    await user.type(confirmInput, 'Password456');
    await user.tab();

    await waitFor(() => {
      expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
    });
  });

  it('submits form with valid data', async () => {
    const user = userEvent.setup();
    vi.mocked(auth.signUp).mockResolvedValueOnce({
      isSignUpComplete: false,
      nextStep: {
        signUpStep: 'CONFIRM_SIGN_UP',
        codeDeliveryDetails: {
          destination: 't***@example.com',
          deliveryMedium: 'EMAIL',
          attributeName: 'email',
        },
      },
      userId: 'test-user-id',
    });

    render(<SignUpForm onSuccess={mockOnSuccess} />);

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'Password123');
    await user.type(screen.getByLabelText(/confirm password/i), 'Password123');
    await user.click(screen.getByRole('button', { name: /sign up/i }));

    await waitFor(() => {
      expect(auth.signUp).toHaveBeenCalledWith({
        username: 'test@example.com',
        password: 'Password123',
        options: {
          userAttributes: {
            email: 'test@example.com',
          },
        },
      });
      expect(mockOnSuccess).toHaveBeenCalledWith('test@example.com');
    });
  });

  it('displays error for duplicate email', async () => {
    const user = userEvent.setup();
    const error = new Error('User already exists');
    error.name = 'UsernameExistsException';
    vi.mocked(auth.signUp).mockRejectedValueOnce(error);

    render(<SignUpForm onSuccess={mockOnSuccess} onError={mockOnError} />);

    await user.type(screen.getByLabelText(/email/i), 'existing@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'Password123');
    await user.type(screen.getByLabelText(/confirm password/i), 'Password123');
    await user.click(screen.getByRole('button', { name: /sign up/i }));

    await waitFor(() => {
      expect(screen.getByText(/an account with this email already exists/i)).toBeInTheDocument();
      expect(mockOnError).toHaveBeenCalledWith(error);
    });
  });

  it('displays error for invalid password', async () => {
    const user = userEvent.setup();
    const error = new Error('Invalid password');
    error.name = 'InvalidPasswordException';
    vi.mocked(auth.signUp).mockRejectedValueOnce(error);

    render(<SignUpForm onSuccess={mockOnSuccess} onError={mockOnError} />);

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'Password123');
    await user.type(screen.getByLabelText(/confirm password/i), 'Password123');
    await user.click(screen.getByRole('button', { name: /sign up/i }));

    await waitFor(() => {
      expect(screen.getByText(/password does not meet requirements/i)).toBeInTheDocument();
    });
  });

  it('shows loading state during submission', async () => {
    const user = userEvent.setup();
    vi.mocked(auth.signUp).mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100))
    );

    render(<SignUpForm onSuccess={mockOnSuccess} />);

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'Password123');
    await user.type(screen.getByLabelText(/confirm password/i), 'Password123');

    await waitFor(() => {
      expect(screen.queryByText(/passwords do not match/i)).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /sign up/i }));

    await waitFor(() => {
      expect(screen.getByText(/creating account/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /creating account/i })).toBeDisabled();
  });

  it('displays network error message', async () => {
    const user = userEvent.setup();
    const error = new Error('Network error');
    vi.mocked(auth.signUp).mockRejectedValueOnce(error);

    render(<SignUpForm onSuccess={mockOnSuccess} />);

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'Password123');
    await user.type(screen.getByLabelText(/confirm password/i), 'Password123');

    await waitFor(() => {
      expect(screen.queryByText(/passwords do not match/i)).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /sign up/i }));

    await waitFor(() => {
      expect(screen.getByText(/unable to connect/i)).toBeInTheDocument();
    });
  });
});
