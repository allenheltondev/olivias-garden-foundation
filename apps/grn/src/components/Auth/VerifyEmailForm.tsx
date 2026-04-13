import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { confirmSignUp, resendSignUpCode } from 'aws-amplify/auth';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { mapAuthError } from '../../utils/authErrors';

export interface VerifyEmailFormData {
  code: string;
}

export interface VerifyEmailFormProps {
  email: string;
  onSuccess: () => void;
  onResend?: () => void;
  onError?: (error: Error) => void;
}

export const VerifyEmailForm: React.FC<VerifyEmailFormProps> = ({
  email,
  onSuccess,
  onResend,
  onError,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [resendSuccess, setResendSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<VerifyEmailFormData>({
    mode: 'onChange',
  });

  const onSubmit = async (data: VerifyEmailFormData) => {
    setIsSubmitting(true);
    setServerError(null);
    setResendSuccess(false);

    try {
      await confirmSignUp({
        username: email,
        confirmationCode: data.code,
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
    setIsResending(true);
    setServerError(null);
    setResendSuccess(false);

    try {
      await resendSignUpCode({ username: email });
      setResendSuccess(true);
      onResend?.();
    } catch (error) {
      const err = error as Error;
      setServerError(mapAuthError(err));
      onError?.(err);
    } finally {
      setIsResending(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {serverError && (
        <div
          className="p-4 bg-error/10 border border-error rounded-base text-error text-sm"
          role="alert"
        >
          {serverError}
        </div>
      )}

      {resendSuccess && (
        <div
          className="p-4 bg-success/10 border border-success rounded-base text-success text-sm"
          role="status"
        >
          Verification code sent successfully!
        </div>
      )}

      <p className="text-sm text-neutral-600">
        We've sent a verification code to <strong>{email}</strong>. Please enter it below to verify your account.
      </p>

      <Input
        type="text"
        label="Verification Code"
        placeholder="Enter 6-digit code"
        error={errors.code?.message}
        required
        autoComplete="one-time-code"
        {...register('code', {
          required: 'Verification code is required',
          pattern: {
            value: /^\d{6}$/,
            message: 'Code must be 6 digits',
          },
        })}
      />

      <div className="space-y-2">
        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          loading={isSubmitting}
          disabled={isSubmitting || isResending}
        >
          {isSubmitting ? 'Verifying...' : 'Verify Email'}
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="md"
          fullWidth
          onClick={handleResendCode}
          disabled={isSubmitting || isResending}
        >
          {isResending ? 'Sending...' : 'Resend Code'}
        </Button>
      </div>
    </form>
  );
};
