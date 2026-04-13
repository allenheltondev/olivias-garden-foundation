import { useState, useEffect, useCallback } from 'react';
import {
  signIn as amplifySignIn,
  signOut as amplifySignOut,
  getCurrentUser,
  fetchAuthSession,
  type AuthUser,
} from 'aws-amplify/auth';
import { logger } from '../utils/logging';
import { getRedactedErrorInfo } from '../utils/authErrors';

/**
 * Authentication state interface
 */
export interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Sign-in credentials
 */
export interface SignInCredentials {
  username: string;
  password: string;
}

/**
 * Custom hook for managing authentication state with AWS Amplify
 *
 * Features:
 * - Manages authentication state (user, loading, error)
 * - Provides signIn and signOut methods
 * - Automatically checks auth status on mount
 * - Handles token refresh automatically via Amplify
 *
 * @returns Authentication state and methods
 */
export function useAuth() {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    error: null,
  });

  /**
   * Check current authentication status
   */
  const checkAuthStatus = useCallback(async () => {
    try {
      setAuthState((prev) => ({ ...prev, isLoading: true, error: null }));

      // Get the current authenticated user
      const user = await getCurrentUser();

      // Verify the session is valid (this will trigger token refresh if needed)
      await fetchAuthSession();

      setAuthState({
        user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
    } catch {
      // User is not authenticated or session is invalid
      setAuthState({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: null, // Not an error, just not authenticated
      });
    }
  }, []);

  /**
   * Sign in with username and password
   */
  const signIn = useCallback(
    async (credentials: SignInCredentials) => {
      try {
        setAuthState((prev) => ({ ...prev, isLoading: true, error: null }));

        logger.authEvent('sign_in_attempt');

        // Sign in with Amplify
        const { isSignedIn, nextStep } = await amplifySignIn({
          username: credentials.username,
          password: credentials.password,
        });

        if (isSignedIn) {
          // Get the user details after successful sign-in
          await checkAuthStatus();
          logger.authEvent('sign_in_success');
        } else {
          // Handle additional sign-in steps if needed (MFA, etc.)
          logger.warn('Additional sign-in steps required', { nextStep: nextStep.signInStep });
          setAuthState((prev) => ({
            ...prev,
            isLoading: false,
            error: new Error('Additional authentication steps required'),
          }));
        }
      } catch (error) {
        const err = error as Error;
        logger.error('Sign-in failed', err, getRedactedErrorInfo(err, 'sign_in'));
        setAuthState((prev) => ({
          ...prev,
          isLoading: false,
          error: err,
        }));
        throw error;
      }
    },
    [checkAuthStatus]
  );

  /**
   * Sign out the current user
   */
  const signOut = useCallback(async () => {
    try {
      setAuthState((prev) => ({ ...prev, isLoading: true, error: null }));

      logger.authEvent('sign_out_attempt');

      // Sign out with Amplify
      await amplifySignOut();

      setAuthState({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
      });

      logger.authEvent('sign_out_success');
    } catch (error) {
      const err = error as Error;
      logger.error('Sign-out failed', err, getRedactedErrorInfo(err, 'sign_out'));
      setAuthState((prev) => ({
        ...prev,
        isLoading: false,
        error: err,
      }));
      throw error;
    }
  }, []);

  /**
   * Clear any authentication errors
   */
  const clearError = useCallback(() => {
    setAuthState((prev) => ({ ...prev, error: null }));
  }, []);

  // Check authentication status on mount
  useEffect(() => {
    void checkAuthStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for unauthorized events from the API client
  useEffect(() => {
    const handleUnauthorized = () => {
      setAuthState({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: new Error('Session expired'),
      });
    };

    window.addEventListener('auth:unauthorized', handleUnauthorized);

    return () => {
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
    };
  }, []);

  // Cross-tab logout propagation via storage events
  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      // Listen for Amplify auth storage changes (token removal indicates logout)
      if (event.key && event.key.includes('CognitoIdentityServiceProvider')) {
        // If tokens are cleared in another tab, update auth state
        if (event.newValue === null && authState.isAuthenticated) {
          setAuthState({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            error: null,
          });
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [authState.isAuthenticated]);

  // Re-check auth state when tab becomes visible (handles cross-tab scenarios)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkAuthStatus();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [checkAuthStatus]);

  return {
    ...authState,
    signIn,
    signOut,
    clearError,
    refreshAuth: checkAuthStatus,
  };
}

export default useAuth;
