import { useState, type FormEvent } from 'react';
import { useAuth } from '../../hooks/useAuth';

/**
 * Sign-In Component
 *
 * Mobile-first authentication form for the Community Food Coordination Platform.
 * Provides a simple, low-friction sign-in experience optimized for one-handed use.
 *
 * Features:
 * - Email and password authentication via AWS Cognito
 * - Loading states during authentication
 * - Clear error messaging
 * - Mobile-optimized touch targets (minimum 44x44px)
 * - Accessible form controls with proper labels
 * - Auto-redirect to profile after successful sign-in
 */
export function SignIn() {
  const { signIn, isLoading, error, clearError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  /**
   * Handle form submission
   */
  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    // Clear any previous errors
    clearError();
    setLocalError(null);

    // Basic validation
    if (!email.trim()) {
      setLocalError('Email is required');
      return;
    }

    if (!password) {
      setLocalError('Password is required');
      return;
    }

    try {
      await signIn({
        username: email.trim(),
        password: password,
      });
      // Redirect happens automatically via useAuth hook
    } catch (err) {
      // Error is handled by useAuth hook
      console.error('Sign-in failed:', err);
    }
  };

  /**
   * Get user-friendly error message
   */
  const getErrorMessage = (): string | null => {
    if (localError) return localError;
    if (!error) return null;

    // Map common Amplify errors to user-friendly messages
    const errorMessage = error.message.toLowerCase();

    if (errorMessage.includes('incorrect username or password')) {
      return 'Incorrect email or password. Please try again.';
    }

    if (errorMessage.includes('user does not exist')) {
      return 'No account found with this email.';
    }

    if (errorMessage.includes('password attempts exceeded')) {
      return 'Too many failed attempts. Please try again later.';
    }

    if (errorMessage.includes('network')) {
      return 'Network error. Please check your connection and try again.';
    }

    return 'Sign-in failed. Please try again.';
  };

  const errorMessage = getErrorMessage();

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-8">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Welcome
          </h1>
          <p className="text-gray-600">
            Sign in to access the Community Food Coordination Platform
          </p>
        </div>

        {/* Sign-in form */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Error message */}
            {errorMessage && (
              <div
                className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-md text-sm"
                role="alert"
                aria-live="polite"
              >
                {errorMessage}
              </div>
            )}

            {/* Email field */}
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
                className="w-full px-4 py-3 border border-gray-300 rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed text-base"
                placeholder="you@example.com"
                aria-describedby={errorMessage ? 'error-message' : undefined}
              />
            </div>

            {/* Password field */}
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                className="w-full px-4 py-3 border border-gray-300 rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed text-base"
                placeholder="Enter your password"
                aria-describedby={errorMessage ? 'error-message' : undefined}
              />
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-blue-600 text-white py-3 px-4 rounded-md font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-blue-400 disabled:cursor-not-allowed transition-colors min-h-[44px] text-base"
              aria-busy={isLoading}
            >
              {isLoading ? (
                <span className="flex items-center justify-center">
                  <svg
                    className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Signing in...
                </span>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          {/* Additional info */}
          <div className="mt-6 text-center text-sm text-gray-600">
            <p>
              For Phase 0, users are created manually in the Cognito console.
            </p>
          </div>
        </div>

        {/* Footer note */}
        <div className="mt-6 text-center text-xs text-gray-500">
          <p>
            By signing in, you agree to use this platform for community food coordination.
          </p>
        </div>
      </div>
    </div>
  );
}

export default SignIn;
