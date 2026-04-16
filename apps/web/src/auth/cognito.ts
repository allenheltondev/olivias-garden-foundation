import {
  buildAuthSession,
  clearStoredSession,
  readStoredSession,
  type AuthSession,
  writeStoredSession,
} from './session';

export interface CognitoConfig {
  clientId: string;
  userPoolId: string;
  domain: string;
  enabled: boolean;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeDomain(domain: string): string {
  return domain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

function getUserPoolRegion(userPoolId: string): string {
  const [region] = userPoolId.split('_');
  return region ?? '';
}

function getIdentityProviderEndpoint(config: CognitoConfig): string {
  const region = getUserPoolRegion(config.userPoolId);
  if (!region) {
    throw new Error('Login is not configured for this environment.');
  }

  return `https://cognito-idp.${region}.amazonaws.com/`;
}

function createCognitoError(error: { __type?: string; code?: string; message?: string }) {
  const name = error.__type?.split('#').pop() || error.code || 'CognitoError';
  const cognitoError = new Error(error.message || 'Authentication failed.');
  cognitoError.name = name;
  return cognitoError;
}

async function callCognito<TResponse>(
  config: CognitoConfig,
  target: string,
  body: Record<string, unknown>,
): Promise<TResponse> {
  const response = await fetch(getIdentityProviderEndpoint(config), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    throw createCognitoError({
      __type: typeof payload.__type === 'string' ? payload.__type : undefined,
      code: typeof payload.code === 'string' ? payload.code : undefined,
      message: typeof payload.message === 'string' ? payload.message : undefined,
    });
  }

  return payload as TResponse;
}

function mapAuthError(error: unknown): Error {
  if (error instanceof Error) {
    const errorName = error.name;
    const errorMessage = error.message.toLowerCase();

    if (errorName === 'UsernameExistsException') {
      return new Error('An account with this email already exists.');
    }

    if (errorName === 'InvalidPasswordException') {
      return new Error('Password does not meet requirements.');
    }

    if (errorName === 'InvalidParameterException') {
      return new Error('Invalid input. Please check your information.');
    }

    if (errorName === 'CodeMismatchException') {
      return new Error('That verification code is not valid.');
    }

    if (errorName === 'ExpiredCodeException') {
      return new Error('That verification code has expired. Request a new one.');
    }

    if (errorName === 'UserNotConfirmedException') {
      return new Error('Please verify your email address before logging in.');
    }

    if (errorName === 'NotAuthorizedException' || errorName === 'UserNotFoundException') {
      return new Error('Invalid email or password.');
    }

    if (
      errorName === 'TooManyRequestsException' ||
      errorName === 'LimitExceededException' ||
      errorName === 'TooManyFailedAttemptsException'
    ) {
      return new Error('Too many attempts. Please try again later.');
    }

    if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
      return new Error('Unable to connect right now. Please try again.');
    }

    return error;
  }

  return new Error('Authentication failed. Please try again.');
}

interface InitiateAuthResponse {
  AuthenticationResult?: {
    AccessToken: string;
    IdToken: string;
    RefreshToken?: string;
    ExpiresIn: number;
  };
}

interface SignUpResponse {
  UserConfirmed?: boolean;
}

export interface SignUpResult {
  userConfirmed: boolean;
}

export function getCognitoConfig(): CognitoConfig {
  const clientId = asNonEmptyString(import.meta.env.VITE_AUTH_USER_POOL_CLIENT_ID);
  const userPoolId = asNonEmptyString(import.meta.env.VITE_AUTH_USER_POOL_ID);
  const domain = asNonEmptyString(import.meta.env.VITE_AUTH_USER_POOL_DOMAIN);

  return {
    clientId: clientId ?? '',
    userPoolId: userPoolId ?? '',
    domain: domain ? normalizeDomain(domain) : '',
    enabled: Boolean(clientId && userPoolId),
  };
}

export async function signInWithPassword(
  config: CognitoConfig,
  email: string,
  password: string,
): Promise<AuthSession> {
  if (!config.enabled) {
    throw new Error('Login is not configured for this environment.');
  }

  try {
    const response = await callCognito<InitiateAuthResponse>(config, 'InitiateAuth', {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: config.clientId,
      AuthParameters: {
        USERNAME: email.trim(),
        PASSWORD: password,
      },
    });

    if (!response.AuthenticationResult) {
      throw new Error('Unable to complete sign-in. Please try again.');
    }

    const session = buildAuthSession({
      access_token: response.AuthenticationResult.AccessToken,
      id_token: response.AuthenticationResult.IdToken,
      refresh_token: response.AuthenticationResult.RefreshToken,
      expires_in: response.AuthenticationResult.ExpiresIn,
    });

    writeStoredSession(session);
    return session;
  } catch (error) {
    throw mapAuthError(error);
  }
}

export async function signUpWithPassword(
  config: CognitoConfig,
  email: string,
  password: string,
  firstName: string,
  lastName: string,
  newsletterOptIn: boolean,
): Promise<SignUpResult> {
  if (!config.enabled) {
    throw new Error('Login is not configured for this environment.');
  }

  try {
    const response = await callCognito<SignUpResponse>(config, 'SignUp', {
      ClientId: config.clientId,
      Username: email.trim(),
      Password: password,
      UserAttributes: [
        {
          Name: 'email',
          Value: email.trim(),
        },
        {
          Name: 'given_name',
          Value: firstName.trim(),
        },
        {
          Name: 'family_name',
          Value: lastName.trim(),
        },
        {
          Name: 'name',
          Value: `${firstName.trim()} ${lastName.trim()}`,
        },
        {
          Name: 'custom:newsletter_opt_in',
          Value: newsletterOptIn ? 'true' : 'false',
        },
      ],
    });

    return {
      userConfirmed: Boolean(response.UserConfirmed),
    };
  } catch (error) {
    throw mapAuthError(error);
  }
}

export async function confirmSignUp(
  config: CognitoConfig,
  email: string,
  code: string,
): Promise<void> {
  if (!config.enabled) {
    throw new Error('Login is not configured for this environment.');
  }

  try {
    await callCognito(config, 'ConfirmSignUp', {
      ClientId: config.clientId,
      Username: email.trim(),
      ConfirmationCode: code.trim(),
    });
  } catch (error) {
    throw mapAuthError(error);
  }
}

export async function resendSignUpCode(config: CognitoConfig, email: string): Promise<void> {
  if (!config.enabled) {
    throw new Error('Login is not configured for this environment.');
  }

  try {
    await callCognito(config, 'ResendConfirmationCode', {
      ClientId: config.clientId,
      Username: email.trim(),
    });
  } catch (error) {
    throw mapAuthError(error);
  }
}

export async function requestPasswordReset(config: CognitoConfig, email: string): Promise<void> {
  if (!config.enabled) {
    throw new Error('Login is not configured for this environment.');
  }

  try {
    await callCognito(config, 'ForgotPassword', {
      ClientId: config.clientId,
      Username: email.trim(),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'UserNotFoundException') {
      return;
    }

    throw mapAuthError(error);
  }
}

export async function confirmPasswordReset(
  config: CognitoConfig,
  email: string,
  code: string,
  password: string,
): Promise<void> {
  if (!config.enabled) {
    throw new Error('Login is not configured for this environment.');
  }

  try {
    await callCognito(config, 'ConfirmForgotPassword', {
      ClientId: config.clientId,
      Username: email.trim(),
      ConfirmationCode: code.trim(),
      Password: password,
    });
  } catch (error) {
    throw mapAuthError(error);
  }
}

export async function restoreAuthSession(config: CognitoConfig): Promise<AuthSession | null> {
  if (!config.enabled) {
    clearStoredSession();
    return null;
  }

  const stored = readStoredSession();
  if (!stored) return null;

  if (stored.expiresAt > Date.now()) {
    return stored;
  }

  if (!stored.refreshToken) {
    clearStoredSession();
    return null;
  }

  try {
    const response = await callCognito<InitiateAuthResponse>(config, 'InitiateAuth', {
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: config.clientId,
      AuthParameters: {
        REFRESH_TOKEN: stored.refreshToken,
      },
    });

    if (!response.AuthenticationResult) {
      clearStoredSession();
      return null;
    }

    const session = buildAuthSession({
      access_token: response.AuthenticationResult.AccessToken,
      id_token: response.AuthenticationResult.IdToken,
      refresh_token: stored.refreshToken,
      expires_in: response.AuthenticationResult.ExpiresIn,
    });

    writeStoredSession(session);
    return session;
  } catch {
    clearStoredSession();
    return null;
  }
}

export function signOut(_config: CognitoConfig) {
  clearStoredSession();
}
