import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { resetPassword, confirmResetPassword } from 'aws-amplify/auth';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { isValidEmail, validatePassword } from '../../utils/validation';
import { mapAuthError } from '../../utils/authErrors';

export interface ForgotPasswordFormData {
  email: string;
}

export interface ResetPasswordFormData {
  code: string;
  newPassword: string;
  confirmPassword: string;
}

export interface ForgotPasswordFormProps {
  onSuccess: () => void;
  onError?: (error: Error) => void;
}

export const ForgotPasswordForm: React.FC<ForgotPasswordFormProps> = ({
  onSuccess,
  onError,
}) => {
  const [step, setStep] = useState<'request' | 'reset'>('request');
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register: registerRequest,
    handleSubmit: handleSubmitRequest,
    formState: { errors: requestErrors },
  } = useForm<ForgotPasswordFormData>({
    mode: 'onChange',
  });

  const {
    register: registerReset,
    handleSubmit: handleSubmitReset,
    watch,
    formState: { errors: resetErrors },
  } = useForm<ResetPasswordFormData>({
    mode: 'onChange',
  });

  const newPassword = watch('newPassword');

  const onSubmitRequest = async (data: ForgotPasswordFormData) => {
    setIsSubmitting(true);
    setServerError(null);

    try {
      await resetPassword({ username: data.email });
      setEmail(data.email);
      setStep('reset');
    } catch (error) {
      const err = error as Error;

      // Don't reveal whether account exists
      if (err.name === 'UserNotFoundException') {
        // Still proceed to reset step to avoid revealing account existence
        setEmail(data.email);
        setStep('reset');
        return;
      }

      setServerError(mapAuthError(err));
      onError?.(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const onSubmitReset = async (data: ResetPasswordFormData) => {
    setIsSubmitting(true);
    setServerError(null);

    try {
      await confirmResetPassword({
        username: email,
        confirmationCode: data.code,
        newPassword: data.newPassword,
      });

      onSuccess();
    } catch (error) {
      const err = error as Error;
      setServerError(mapAuthError(err));
      onError?.(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendCode = async () => {
    setIsSubmitting(true);
    setServerError(null);

    try {
      await resetPassword({ username: email });
      setServerError(null);
    } catch (error) {
      const err = error as Error;
      setServerError(mapAuthError(err));
      onError?.(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (step === 'request') {
    return (
      <form onSubmit={handleSubmitRequest(onSubmitRequest)} className="space-y-4">
        {serverError && (
          <div
            className="p-4 bg-error/10 border border-error rounded-base text-error text-sm"
            role="alert"
          >
            {serverError}
          </div>
        )}

        <p className="text-sm text-neutral-600">
          Enter your email address and we'll send you a verification code to reset your password.
        </p>

        <Input
          type="email"
          label="Email"
          placeholder="you@example.com"
          error={requestErrors.email?.message}
          required
          autoComplete="email"
          {...registerRequest('email', {
            required: 'Email is required',
            validate: (value) =>
              isValidEmail(value) || 'Please enter a valid email address',
          })}
        />

        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          loading={isSubmitting}
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Sending code...' : 'Send Code'}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmitReset(onSubmitReset)} className="space-y-4">
      {serverError && (
        <div
          className="p-4 bg-error/10 border border-error rounded-base text-error text-sm"
          role="alert"
        >
          {serverError}
        </div>
      )}

      <p className="text-sm text-neutral-600">
        Enter the verification code sent to {email} and your new password.
      </p>

      <Input
        type="text"
        label="Verification Code"
        placeholder="Enter 6-digit code"
        error={resetErrors.code?.message}
        required
        autoComplete="one-time-code"
        {...registerReset('code', {
          required: 'Verification code is required',
        })}
      />

      <Input
        type="password"
        label="New Password"
        placeholder="Enter new password"
        error={resetErrors.newPassword?.message}
        required
        autoComplete="new-password"
        {...registerReset('newPassword', {
          required: 'Password is required',
          validate: (value) => {
            const result = validatePassword(value);
            if (!result.isValid) {
              return result.errors[0];
            }
            return true;
          },
        })}
      />

      <Input
        type="password"
        label="Confirm New Password"
        placeholder="Confirm new password"
        error={resetErrors.confirmPassword?.message}
        required
        autoComplete="new-password"
        {...registerReset('confirmPassword', {
          required: 'Please confirm your password',
          validate: (value) =>
            value === newPassword || 'Passwords do not match',
        })}
      />

      <div className="space-y-2">
        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          loading={isSubmitting}
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Resetting password...' : 'Reset Password'}
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="md"
          fullWidth
          onClick={handleResendCode}
          disabled={isSubmitting}
        >
          Resend Code
        </Button>
      </div>
    </form>
  );
};
