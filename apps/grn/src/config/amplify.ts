import { Amplify } from 'aws-amplify';

/**
 * AWS Amplify Configuration for Custom Auth UI
 *
 * This configuration integrates with AWS Cognito using custom authentication pages.
 * Cognito Hosted UI is NOT used - all auth flows are rendered as custom React pages.
 *
 * Configuration is loaded from environment variables and fails fast if required values are missing.
 *
 * Required Environment Variables:
 * - VITE_USER_POOL_ID: Cognito User Pool ID
 * - VITE_USER_POOL_CLIENT_ID: Cognito User Pool Client ID
 * - VITE_AWS_REGION: AWS Region (defaults to us-east-1)
 *
 * To get these values:
 * 1. Deploy the backend: `cd services/grn-api && sam deploy --guided`
 * 2. Copy the outputs from the SAM deployment to .env file
 */

export interface AmplifyConfig {
  userPoolId: string;
  userPoolClientId: string;
  region: string;
}

/**
 * Load and validate Amplify configuration from environment variables
 * Fails fast with descriptive error if required configuration is missing
 */
function loadConfig(): AmplifyConfig {
  const userPoolId = import.meta.env.VITE_USER_POOL_ID;
  const userPoolClientId = import.meta.env.VITE_USER_POOL_CLIENT_ID;
  const region = import.meta.env.VITE_AWS_REGION || 'us-east-1';

  // Fail fast with descriptive error if required config is missing
  if (!userPoolId) {
    throw new Error(
      'Missing required configuration: VITE_USER_POOL_ID environment variable is not set. ' +
      'Please ensure .env file exists with the correct values from SAM deployment.'
    );
  }

  if (!userPoolClientId) {
    throw new Error(
      'Missing required configuration: VITE_USER_POOL_CLIENT_ID environment variable is not set. ' +
      'Please ensure .env file exists with the correct values from SAM deployment.'
    );
  }

  return {
    userPoolId,
    userPoolClientId,
    region,
  };
}

/**
 * Configure AWS Amplify Auth for Cognito integration
 *
 * This function configures Amplify Auth with:
 * - Email login (no OAuth/Hosted UI)
 * - Code-based email verification
 * - Password policy: min 8 chars, uppercase, lowercase, numbers required
 * - No MFA in V1
 * - Persistent session storage (localStorage) for cross-session auth
 *
 * Persistence Mode: localStorage (default)
 * - Sessions persist across browser restarts
 * - Tokens stored in localStorage
 * - Suitable for PWA use case where users expect to stay logged in
 * - Cross-tab logout is handled via storage events
 *
 * Call this function once at application startup (in main.tsx)
 */
export function configureAmplify(config?: AmplifyConfig): void {
  const authConfig = config || loadConfig();

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: authConfig.userPoolId,
        userPoolClientId: authConfig.userPoolClientId,

        // Email login only (no OAuth/Hosted UI)
        loginWith: {
          email: true,
        },

        // Email verification via code
        signUpVerificationMethod: 'code',

        // Required user attributes
        userAttributes: {
          email: {
            required: true,
          },
        },

        // Password policy matching Cognito configuration
        passwordFormat: {
          minLength: 8,
          requireLowercase: true,
          requireUppercase: true,
          requireNumbers: true,
          requireSpecialCharacters: false,
        },
      },
    },
  });
}

/**
 * Get the current configuration (useful for testing)
 */
export function getConfig(): AmplifyConfig {
  return loadConfig();
}

/**
 * Get the API endpoint from environment variables
 */
export function getApiEndpoint(): string {
  const endpoint = import.meta.env.VITE_API_URL;

  if (!endpoint) {
    throw new Error(
      'Missing required configuration: VITE_API_URL environment variable is not set. ' +
      'Please ensure .env file exists with the correct values from SAM deployment.'
    );
  }

  return endpoint;
}
