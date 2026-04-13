import React, { useState } from 'react';
import { AuthLayout } from '../components/Auth/AuthLayout';
import { LoginForm } from '../components/Auth/LoginForm';
import { VerifyEmailForm } from '../components/Auth/VerifyEmailForm';

export interface LoginPageProps {
  onSuccess: () => void;
  onNavigateToSignUp?: () => void;
  onNavigateToForgotPassword?: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  onSuccess,
  onNavigateToSignUp,
  onNavigateToForgotPassword,
}) => {
  const [showVerification, setShowVerification] = useState(false);
  const [email, setEmail] = useState('');

  const handleUnverified = (userEmail: string) => {
    setEmail(userEmail);
    setShowVerification(true);
  };

  const handleVerificationSuccess = () => {
    setShowVerification(false);
    // User can now log in
  };

  if (showVerification) {
    return (
      <AuthLayout subtitle="Check your email for a verification code">
        <VerifyEmailForm
          email={email}
          onSuccess={handleVerificationSuccess}
        />
        <div className="mt-4 text-center">
          <button
            onClick={() => setShowVerification(false)}
            className="text-sm text-primary-600 hover:text-primary-700"
          >
            Back to Login
          </button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout subtitle="Sign in to your account">
      <LoginForm
        onSuccess={onSuccess}
        onUnverified={handleUnverified}
      />
      <div className="mt-6 space-y-3 text-center text-sm">
        {onNavigateToForgotPassword && (
          <button
            onClick={onNavigateToForgotPassword}
            className="block w-full text-primary-600 hover:text-primary-700 cursor-pointer"
          >
            Forgot your password?
          </button>
        )}
        {onNavigateToSignUp && (
          <p className="text-neutral-600">
            Don't have an account?{' '}
            <button
              onClick={onNavigateToSignUp}
              className="text-primary-600 hover:text-primary-700 font-medium cursor-pointer"
            >
              Sign up
            </button>
          </p>
        )}
      </div>
    </AuthLayout>
  );
};
