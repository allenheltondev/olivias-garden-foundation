import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { signUp } from 'aws-amplify/auth';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { isValidEmail, validatePassword } from '../../utils/validation';
import { mapAuthError } from '../../utils/authErrors';

export interface SignUpFormData {
  email: string;
  password: string;
  confirmPassword: string;
}

export interface SignUpFormProps {
  onSuccess: (email: string) => void;
  onError?: (error: Error) => void;
}

export const SignUpForm: React.FC<SignUpFormProps> = ({
  onSuccess,
  onError,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<SignUpFormData>({
    mode: 'onChange',
  });

  const password = watch('password');

  const onSubmit = async (data: SignUpFormData) => {
    setIsSubmitting(true);
    setServerError(null);

    try {
      await signUp({
        username: data.email,
        password: data.password,
        options: {
          userAttributes: {
            email: data.email,
          },
        },
      });

      onSuccess(data.email);
    } catch (error) {
      const err = error as Error;
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
        autoComplete="new-password"
        aria-label="Password"
        {...register('password', {
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
        placeholder="Confirm Password"
        error={errors.confirmPassword?.message}
        required
        autoComplete="new-password"
        aria-label="Confirm Password"
        {...register('confirmPassword', {
          required: 'Please confirm your password',
          validate: (value) =>
            value === password || 'Passwords do not match',
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
        {isSubmitting ? 'Creating account...' : 'Sign Up'}
      </Button>
    </form>
  );
};
