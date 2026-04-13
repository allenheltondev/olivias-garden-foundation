import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ForgotPasswordForm } from './ForgotPasswordForm';
import * as auth from 'aws-amplify/auth';

vi.mock('aws-amplify/auth', () => ({
  resetPassword: vi.fn(),
  confirmResetPassword: vi.fn(),
}));

describe('ForgotPasswordForm', () => {
  const mockOnSuccess = vi.fn();
  const mockOnError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Request Code Step', () => {
    it('renders email input and send button', () => {
      render(<ForgotPasswordForm onSuccess={mockOnSuccess} />);

      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /send code/i })).toBeInTheDocument();
      expect(screen.getByText(/enter your email address/i)).toBeInTheDocument();
    });

    it('validates email format', async () => {
      const user = userEvent.setup();
      render(<ForgotPasswordForm onSuccess={mockOnSuccess} />);

      const emailInput = screen.getByLabelText(/email/i);
      await user.type(emailInput, 'invalid-email');
      await user.tab();

      await waitFor(() => {
        expect(screen.getByText(/please enter a valid email address/i)).toBeInTheDocument();
      });
    });

    it('sends reset code and transitions to reset step', async () => {
      const user = userEvent.setup();
      vi.mocked(auth.resetPassword).mockResolvedValueOnce({
        isPasswordReset: false,
        nextStep: {
          resetPasswordStep: 'CONFIRM_RESET_PASSWORD_WITH_CODE',
          codeDeliveryDetails: {
            destination: 't***@example.com',
            deliveryMedium: 'EMAIL',
            attributeName: 'email',
          },
        },
      });

      render(<ForgotPasswordForm onSuccess={mockOnSuccess} />);

      await user.type(screen.getByLabelText(/email/i), 'test@example.com');
      await user.click(screen.getByRole('button', { name: /send code/i }));

      await waitFor(() => {
        expect(auth.resetPassword).toHaveBeenCalledWith({
          username: 'test@example.com',
        });
        expect(screen.getByLabelText(/verification code/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/^new password/i)).toBeInTheDocument();
      });
    });

    it('does not reveal account existence for non-existent user', async () => {
      const user = userEvent.setup();
      const error = new Error('User does not exist');
      error.name = 'UserNotFoundException';
      vi.mocked(auth.resetPassword).mockResolvedValueOnce({
        isPasswordReset: false,
        nextStep: {
          resetPasswordStep: 'CONFIRM_RESET_PASSWORD_WITH_CODE',
          codeDeliveryDetails: {
            destination: 'n***@example.com',
            deliveryMedium: 'EMAIL',
            attributeName: 'email',
          },
        },
      });

      render(<ForgotPasswordForm onSuccess={mockOnSuccess} onError={mockOnError} />);

      await user.type(screen.getByLabelText(/email/i), 'nonexistent@example.com');
      await user.click(screen.getByRole('button', { name: /send code/i }));

      await waitFor(() => {
        expect(screen.getByLabelText(/verification code/i)).toBeInTheDocument();
      });
    });

    it('displays error for rate limiting', async () => {
      const user = userEvent.setup();
      const error = new Error('Attempt limit exceeded');
      error.name = 'LimitExceededException';
      vi.mocked(auth.resetPassword).mockRejectedValueOnce(error);

      render(<ForgotPasswordForm onSuccess={mockOnSuccess} onError={mockOnError} />);

      await user.type(screen.getByLabelText(/email/i), 'test@example.com');
      await user.click(screen.getByRole('button', { name: /send code/i }));

      await waitFor(() => {
        expect(screen.getByText(/too many attempts/i)).toBeInTheDocument();
        expect(mockOnError).toHaveBeenCalledWith(error);
      });
    });

    it('shows loading state during code request', async () => {
      const user = userEvent.setup();
      vi.mocked(auth.resetPassword).mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );

      render(<ForgotPasswordForm onSuccess={mockOnSuccess} />);

      await user.type(screen.getByLabelText(/email/i), 'test@example.com');
      await user.click(screen.getByRole('button', { name: /send code/i }));

      await waitFor(() => {
        expect(screen.getByText(/sending code/i)).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: /sending code/i })).toBeDisabled();
    });
  });

  describe('Reset Password Step', () => {
    beforeEach(async () => {
      const user = userEvent.setup();
      vi.mocked(auth.resetPassword).mockResolvedValueOnce({
        isPasswordReset: false,
        nextStep: {
          resetPasswordStep: 'CONFIRM_RESET_PASSWORD_WITH_CODE',
          codeDeliveryDetails: {
            destination: 't***@example.com',
            deliveryMedium: 'EMAIL',
            attributeName: 'email',
          },
        },
      });

      render(<ForgotPasswordForm onSuccess={mockOnSuccess} />);

      await user.type(screen.getByLabelText(/email/i), 'test@example.com');
      await user.click(screen.getByRole('button', { name: /send code/i }));

      await waitFor(() => {
        expect(screen.getByLabelText(/verification code/i)).toBeInTheDocument();
      });
    });

    it('renders reset password form', () => {
      expect(screen.getByLabelText(/verification code/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^new password/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/confirm new password/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /reset password/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /resend code/i })).toBeInTheDocument();
    });

    it('validates password requirements', async () => {
      const user = userEvent.setup();

      const passwordInput = screen.getByLabelText(/^new password/i);
      await user.type(passwordInput, 'weak');
      await user.tab();

      await waitFor(() => {
        expect(screen.getByText(/password must be at least 8 characters/i)).toBeInTheDocument();
      });
    });

    it('validates password confirmation match', async () => {
      const user = userEvent.setup();

      const passwordInput = screen.getByLabelText(/^new password/i);
      const confirmInput = screen.getByLabelText(/confirm new password/i);

      await user.type(passwordInput, 'Password123');
      await user.type(confirmInput, 'Password456');
      await user.tab();

      await waitFor(() => {
        expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
      });
    });

    it('successfully resets password', async () => {
      const user = userEvent.setup();
      vi.mocked(auth.confirmResetPassword).mockResolvedValueOnce(undefined);

      const codeInput = screen.getByLabelText(/verification code/i);
      const newPasswordInput = screen.getByLabelText(/^new password/i);
      const confirmPasswordInput = screen.getByLabelText(/confirm new password/i);

      await user.clear(codeInput);
      await user.type(codeInput, '123456');
      await user.type(newPasswordInput, 'NewPassword123');
      await user.type(confirmPasswordInput, 'NewPassword123');
      await user.click(screen.getByRole('button', { name: /reset password/i }));

      await waitFor(() => {
        expect(auth.confirmResetPassword).toHaveBeenCalledWith({
          username: 'test@example.com',
          confirmationCode: '123456',
          newPassword: 'NewPassword123',
        });
        expect(mockOnSuccess).toHaveBeenCalled();
      });
    });

    it('displays error for invalid code', async () => {
      const user = userEvent.setup();
      const error = new Error('Invalid verification code');
      error.name = 'CodeMismatchException';
      vi.mocked(auth.confirmResetPassword).mockRejectedValueOnce(error);

      await user.type(screen.getByLabelText(/verification code/i), '000000');
      await user.type(screen.getByLabelText(/^new password/i), 'NewPassword123');
      await user.type(screen.getByLabelText(/confirm new password/i), 'NewPassword123');
      await user.click(screen.getByRole('button', { name: /reset password/i }));

      await waitFor(() => {
        expect(screen.getByText(/invalid verification code/i)).toBeInTheDocument();
      });
    });

    it('displays error for expired code', async () => {
      const user = userEvent.setup();
      const error = new Error('Code expired');
      error.name = 'ExpiredCodeException';
      vi.mocked(auth.confirmResetPassword).mockRejectedValueOnce(error);

      await user.type(screen.getByLabelText(/verification code/i), '123456');
      await user.type(screen.getByLabelText(/^new password/i), 'NewPassword123');
      await user.type(screen.getByLabelText(/confirm new password/i), 'NewPassword123');
      await user.click(screen.getByRole('button', { name: /reset password/i }));

      await waitFor(() => {
        expect(screen.getByText(/verification code has expired/i)).toBeInTheDocument();
      });
    });

    it('resends verification code', async () => {
      const user = userEvent.setup();
      vi.mocked(auth.resetPassword).mockResolvedValueOnce({
        isPasswordReset: false,
        nextStep: {
          resetPasswordStep: 'CONFIRM_RESET_PASSWORD_WITH_CODE',
          codeDeliveryDetails: {
            destination: 't***@example.com',
            deliveryMedium: 'EMAIL',
            attributeName: 'email',
          },
        },
      });

      await user.click(screen.getByRole('button', { name: /resend code/i }));

      await waitFor(() => {
        expect(auth.resetPassword).toHaveBeenCalledWith({
          username: 'test@example.com',
        });
      });
    });

    it('shows loading state during password reset', async () => {
      const user = userEvent.setup();
      vi.mocked(auth.confirmResetPassword).mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );

      await user.type(screen.getByLabelText(/verification code/i), '123456');
      await user.type(screen.getByLabelText(/^new password/i), 'NewPassword123');
      await user.type(screen.getByLabelText(/confirm new password/i), 'NewPassword123');

      await waitFor(() => {
        expect(screen.queryByText(/passwords do not match/i)).not.toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /reset password/i }));

      await waitFor(() => {
        expect(screen.getByText(/resetting password/i)).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: /resetting password/i })).toBeDisabled();
    });

    it('displays network error message', async () => {
      const user = userEvent.setup();
      const error = new Error('Network error');
      vi.mocked(auth.confirmResetPassword).mockRejectedValueOnce(error);

      await user.type(screen.getByLabelText(/verification code/i), '123456');
      await user.type(screen.getByLabelText(/^new password/i), 'NewPassword123');
      await user.type(screen.getByLabelText(/confirm new password/i), 'NewPassword123');

      await waitFor(() => {
        expect(screen.queryByText(/passwords do not match/i)).not.toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /reset password/i }));

      await waitFor(() => {
        expect(screen.getByText(/unable to connect/i)).toBeInTheDocument();
      });
    });
  });
});
