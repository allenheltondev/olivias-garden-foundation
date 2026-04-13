import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VerifyEmailForm } from './VerifyEmailForm';
import * as auth from 'aws-amplify/auth';

vi.mock('aws-amplify/auth', () => ({
  confirmSignUp: vi.fn(),
  resendSignUpCode: vi.fn(),
}));

describe('VerifyEmailForm', () => {
  const mockOnSuccess = vi.fn();
  const mockOnResend = vi.fn();
  const mockOnError = vi.fn();
  const testEmail = 'test@example.com';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders verification form with email', () => {
    render(
      <VerifyEmailForm
        email={testEmail}
        onSuccess={mockOnSuccess}
      />
    );

    expect(screen.getByText(/we've sent a verification code/i)).toBeInTheDocument();
    expect(screen.getByText(testEmail)).toBeInTheDocument();
    expect(screen.getByLabelText(/verification code/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /verify email/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /resend code/i })).toBeInTheDocument();
  });

  it('validates code length', async () => {
    const user = userEvent.setup();
    render(
      <VerifyEmailForm
        email={testEmail}
        onSuccess={mockOnSuccess}
      />
    );

    const codeInput = screen.getByLabelText(/verification code/i);
    await user.type(codeInput, '12');
    await user.tab();

    await waitFor(() => {
      expect(screen.getByText(/code must be 6 digits/i)).toBeInTheDocument();
    });
  });

  it('requires verification code', async () => {
    const user = userEvent.setup();
    render(
      <VerifyEmailForm
        email={testEmail}
        onSuccess={mockOnSuccess}
      />
    );

    const codeInput = screen.getByLabelText(/verification code/i);
    await user.click(codeInput);
    // Type something then delete it to trigger validation
    await user.type(codeInput, '1');
    await user.clear(codeInput);

    await waitFor(() => {
      expect(screen.getByText(/verification code is required/i)).toBeInTheDocument();
    });
  });

  it('successfully verifies email', async () => {
    const user = userEvent.setup();
    vi.mocked(auth.confirmSignUp).mockResolvedValueOnce({
      isSignUpComplete: true,
      nextStep: { signUpStep: 'DONE' },
    });

    render(
      <VerifyEmailForm
        email={testEmail}
        onSuccess={mockOnSuccess}
      />
    );

    await user.type(screen.getByLabelText(/verification code/i), '123456');
    await user.click(screen.getByRole('button', { name: /verify email/i }));

    await waitFor(() => {
      expect(auth.confirmSignUp).toHaveBeenCalledWith({
        username: testEmail,
        confirmationCode: '123456',
      });
      expect(mockOnSuccess).toHaveBeenCalled();
    });
  });

  it('displays error for invalid code', async () => {
    const user = userEvent.setup();
    const error = new Error('Invalid verification code');
    error.name = 'CodeMismatchException';
    vi.mocked(auth.confirmSignUp).mockRejectedValueOnce(error);

    render(
      <VerifyEmailForm
        email={testEmail}
        onSuccess={mockOnSuccess}
        onError={mockOnError}
      />
    );

    await user.type(screen.getByLabelText(/verification code/i), '000000');
    await user.click(screen.getByRole('button', { name: /verify email/i }));

    await waitFor(() => {
      expect(screen.getByText(/invalid verification code/i)).toBeInTheDocument();
      expect(mockOnError).toHaveBeenCalledWith(error);
    });
  });

  it('displays error for expired code', async () => {
    const user = userEvent.setup();
    const error = new Error('Code expired');
    error.name = 'ExpiredCodeException';
    vi.mocked(auth.confirmSignUp).mockRejectedValueOnce(error);

    render(
      <VerifyEmailForm
        email={testEmail}
        onSuccess={mockOnSuccess}
        onError={mockOnError}
      />
    );

    await user.type(screen.getByLabelText(/verification code/i), '123456');
    await user.click(screen.getByRole('button', { name: /verify email/i }));

    await waitFor(() => {
      expect(screen.getByText(/verification code has expired/i)).toBeInTheDocument();
    });
  });

  it('resends verification code', async () => {
    const user = userEvent.setup();
    vi.mocked(auth.resendSignUpCode).mockResolvedValueOnce({
      destination: testEmail,
      deliveryMedium: 'EMAIL',
      attributeName: 'email',
    });

    render(
      <VerifyEmailForm
        email={testEmail}
        onSuccess={mockOnSuccess}
        onResend={mockOnResend}
      />
    );

    await user.click(screen.getByRole('button', { name: /resend code/i }));

    await waitFor(() => {
      expect(auth.resendSignUpCode).toHaveBeenCalledWith({
        username: testEmail,
      });
      expect(mockOnResend).toHaveBeenCalled();
      expect(screen.getByText(/verification code sent successfully/i)).toBeInTheDocument();
    });
  });

  it('displays error when resend fails', async () => {
    const user = userEvent.setup();
    const error = new Error('Limit exceeded');
    error.name = 'LimitExceededException';
    vi.mocked(auth.resendSignUpCode).mockRejectedValueOnce(error);

    render(
      <VerifyEmailForm
        email={testEmail}
        onSuccess={mockOnSuccess}
        onError={mockOnError}
      />
    );

    await user.click(screen.getByRole('button', { name: /resend code/i }));

    await waitFor(() => {
      expect(screen.getByText(/too many attempts/i)).toBeInTheDocument();
      expect(mockOnError).toHaveBeenCalledWith(error);
    });
  });

  it('shows loading state during verification', async () => {
    const user = userEvent.setup();
    vi.mocked(auth.confirmSignUp).mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100))
    );

    render(
      <VerifyEmailForm
        email={testEmail}
        onSuccess={mockOnSuccess}
      />
    );

    await user.type(screen.getByLabelText(/verification code/i), '123456');
    await user.click(screen.getByRole('button', { name: /verify email/i }));

    await waitFor(() => {
      expect(screen.getByText(/verifying/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /verifying/i })).toBeDisabled();
  });

  it('shows loading state during resend', async () => {
    const user = userEvent.setup();
    vi.mocked(auth.resendSignUpCode).mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100))
    );

    render(
      <VerifyEmailForm
        email={testEmail}
        onSuccess={mockOnSuccess}
      />
    );

    await user.click(screen.getByRole('button', { name: /resend code/i }));

    await waitFor(() => {
      expect(screen.getByText(/sending/i)).toBeInTheDocument();
    });
  });

  it('disables buttons during submission', async () => {
    const user = userEvent.setup();
    vi.mocked(auth.confirmSignUp).mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100))
    );

    render(
      <VerifyEmailForm
        email={testEmail}
        onSuccess={mockOnSuccess}
      />
    );

    await user.type(screen.getByLabelText(/verification code/i), '123456');
    await user.click(screen.getByRole('button', { name: /verify email/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /verifying/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /resend code/i })).toBeDisabled();
    });
  });

  it('displays network error message', async () => {
    const user = userEvent.setup();
    const error = new Error('Network error');
    vi.mocked(auth.confirmSignUp).mockRejectedValueOnce(error);

    render(
      <VerifyEmailForm
        email={testEmail}
        onSuccess={mockOnSuccess}
      />
    );

    await user.type(screen.getByLabelText(/verification code/i), '123456');
    await user.click(screen.getByRole('button', { name: /verify email/i }));

    await waitFor(() => {
      expect(screen.getByText(/unable to connect/i)).toBeInTheDocument();
    });
  });

  it('clears success message when submitting again', async () => {
    const user = userEvent.setup();
    vi.mocked(auth.resendSignUpCode).mockResolvedValueOnce({
      destination: testEmail,
      deliveryMedium: 'EMAIL',
      attributeName: 'email',
    });
    vi.mocked(auth.confirmSignUp).mockResolvedValueOnce({
      isSignUpComplete: true,
      nextStep: { signUpStep: 'DONE' },
    });

    render(
      <VerifyEmailForm
        email={testEmail}
        onSuccess={mockOnSuccess}
      />
    );

    // First resend code
    await user.click(screen.getByRole('button', { name: /resend code/i }));

    await waitFor(() => {
      expect(screen.getByText(/verification code sent successfully/i)).toBeInTheDocument();
    });

    // Then submit verification
    await user.type(screen.getByLabelText(/verification code/i), '123456');
    await user.click(screen.getByRole('button', { name: /verify email/i }));

    await waitFor(() => {
      expect(screen.queryByText(/verification code sent successfully/i)).not.toBeInTheDocument();
    });
  });
});
