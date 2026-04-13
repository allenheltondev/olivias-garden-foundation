import React, { useState } from 'react';
import { AuthLayout } from '../components/Auth/AuthLayout';
import { SignUpForm } from '../components/Auth/SignUpForm';
import { VerifyEmailForm } from '../components/Auth/VerifyEmailForm';

export interface SignUpPageProps {
  onSuccess: () => void;
  onNavigateToLogin?: () => void;
}

export const SignUpPage: React.FC<SignUpPageProps> = ({
  onSuccess,
  onNavigateToLogin,
}) => {
  const [showVerification, setShowVerification] = useState(false);
  const [email, setEmail] = useState('');

  const handleSignUpSuccess = (userEmail: string) => {
    setEmail(userEmail);
    setShowVerification(true);
  };

  const handleVerificationSuccess = () => {
    onSuccess();
  };

  if (showVerification) {
    return (
      <AuthLayout subtitle="Check your email for a verification code">
        <VerifyEmailForm
          email={email}
          onSuccess={handleVerificationSuccess}
        />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <SignUpForm onSuccess={handleSignUpSuccess} />
      {onNavigateToLogin && (
        <div className="mt-6 text-center text-sm">
          <p className="text-neutral-600">
            Already have an account?{' '}
            <button
              onClick={onNavigateToLogin}
              className="text-primary-600 hover:text-primary-700 font-medium"
            >
              Sign in
            </button>
          </p>
        </div>
      )}
    </AuthLayout>
  );
};
