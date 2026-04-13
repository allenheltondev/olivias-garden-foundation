import React from 'react';
import { AuthLayout } from '../components/Auth/AuthLayout';
import { ForgotPasswordForm } from '../components/Auth/ForgotPasswordForm';

export interface ForgotPasswordPageProps {
  onSuccess: () => void;
  onNavigateToLogin?: () => void;
}

export const ForgotPasswordPage: React.FC<ForgotPasswordPageProps> = ({
  onSuccess,
  onNavigateToLogin,
}) => {
  return (
    <AuthLayout subtitle="We'll help you get back into your account">
      <ForgotPasswordForm onSuccess={onSuccess} />
      {onNavigateToLogin && (
        <div className="mt-6 text-center text-sm">
          <button
            onClick={onNavigateToLogin}
            className="text-primary-600 hover:text-primary-700"
          >
            Back to Login
          </button>
        </div>
      )}
    </AuthLayout>
  );
};
