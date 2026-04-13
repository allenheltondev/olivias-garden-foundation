import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { signIn } from 'aws-amplify/auth';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { isValidEmail } from '../../utils/validation';
import { mapAuthError, isUnverifiedError } from '../../utils/authErrors';

export interface LoginFormData {
  email: string;
  password: string;
}

export interface LoginFormProps {
  onSuccess: () => void;
  onUnverified: (email: string) => void;
  onError?: (error: Error) => void;
}

export const LoginForm: React.FC<LoginFormProps> = ({
  onSuccess,
  onUnverified,
  onError,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    mode: 'onChange',
  });

  const onSubmit = async (data: LoginFormData) => {
    setIsSubmitting(true);
    setServerError(null);

    try {
      await signIn({
        username: data.email,
        password: data.password,
      });

      onSuccess();
    } catch (error) {
      const err = error as Error;

      // Check if user needs to verify email
      if (isUnverifiedError(err)) {
        onUnverified(data.email);
        return;
      }

      setServerError(mapAuthError(err));
      onError?.(err);
    } finally {
      setIsSubmitting(false);
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

      <Input
        type="email"
        placeholder="Email"
        error={errors.email?.message}
        required
        autoComplete="email"
        aria-label="Email"
        {...register('email', {
          required: 'Email is required',
          validate: (value) =>
            isValidEmail(value) || 'Please enter a valid email address',
        })}
      />

      <Input
        type="password"
        placeholder="Password"
        error={errors.password?.message}
        required
        autoComplete="current-password"
        aria-label="Password"
        {...register('password', {
          required: 'Password is required',
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
        {isSubmitting ? 'Signing in...' : 'Sign In'}
      </Button>
    </form>
  );
};
