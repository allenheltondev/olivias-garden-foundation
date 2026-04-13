import React from 'react';
import { useAuth } from '../../hooks/useAuth';

export interface RequireAuthProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * RequireAuth Component
 *
 * Protects content by requiring authentication. Shows a loading state while
 * checking auth status, and renders children only when authenticated.
 *
 * For Phase 0, this provides a simple protection wrapper. In future phases,
 * this could be extended to support redirect behavior with return-to parameters.
 */
export const RequireAuth: React.FC<RequireAuthProps> = ({
  children,
  fallback,
}) => {
  const { isAuthenticated, isLoading } = useAuth();

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mb-4" />
          <p className="text-neutral-600">Loading...</p>
        </div>
      </div>
    );
  }

  // If not authenticated, show fallback or nothing
  if (!isAuthenticated) {
    return fallback ? <>{fallback}</> : null;
  }

  // Render protected content
  return <>{children}</>;
};
