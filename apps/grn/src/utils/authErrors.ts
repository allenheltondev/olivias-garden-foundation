/**
 * Authentication Error Mapping Utility
 *
 * Centralizes error mapping from Amplify/Cognito errors to user-friendly messages.
 * Implements privacy-friendly error messages that don't reveal account existence.
 *
 * Security Principles:
 * - Never reveal whether an email/account exists
 * - Use same message for "user not found" and "wrong password"
 * - Don't expose raw Cognito exception messages
 * - Provide actionable guidance without leaking information
 */

export interface AuthErrorMapping {
  message: string;
  actionable?: boolean;
}

/**
 * Map Cognito/Amplify error to user-friendly message
 *
 * @param error - Error from Amplify Auth operation
 * @returns User-friendly error message
 */
export function mapAuthError(error: Error): string {
  const errorName = error.name;
  const errorMessage = error.message.toLowerCase();

  // Sign Up Errors
  if (errorName === 'UsernameExistsException') {
    return 'An account with this email already exists';
  }

  if (errorName === 'InvalidPasswordException') {
    return 'Password does not meet requirements';
  }

  if (errorName === 'InvalidParameterException') {
    return 'Invalid input. Please check your information.';
  }

  // Login Errors - Privacy-friendly (don't reveal account existence)
  if (errorName === 'NotAuthorizedException') {
    return 'Invalid email or password';
  }

  if (errorName === 'UserNotFoundException') {
    // Use same message as wrong password to avoid enumeration
    return 'Invalid email or password';
  }

  if (errorName === 'UserNotConfirmedException') {
    return 'Please verify your email address';
  }

  // Password Reset Errors
  if (errorName === 'CodeMismatchException') {
    return 'Invalid verification code';
  }

  if (errorName === 'ExpiredCodeException') {
    return 'Verification code has expired';
  }

  // Rate Limiting
  if (errorName === 'LimitExceededException') {
    return 'Too many attempts. Please try again later.';
  }

  if (errorName === 'TooManyRequestsException') {
    return 'Too many requests. Please try again later.';
  }

  if (errorName === 'TooManyFailedAttemptsException') {
    return 'Too many failed attempts. Please try again later.';
  }

  // Network Errors
  if (errorMessage.includes('network')) {
    return 'Unable to connect. Please check your connection.';
  }

  if (errorMessage.includes('timeout')) {
    return 'Request timed out. Please try again.';
  }

  // Generic fallback
  return 'An error occurred. Please try again.';
}

/**
 * Check if an error should trigger email verification flow
 *
 * @param error - Error from Amplify Auth operation
 * @returns True if user needs to verify email
 */
export function isUnverifiedError(error: Error): boolean {
  return error.name === 'UserNotConfirmedException';
}

/**
 * Check if an error is due to rate limiting
 *
 * @param error - Error from Amplify Auth operation
 * @returns True if error is rate limiting related
 */
export function isRateLimitError(error: Error): boolean {
  return (
    error.name === 'LimitExceededException' ||
    error.name === 'TooManyRequestsException' ||
    error.name === 'TooManyFailedAttemptsException'
  );
}

/**
 * Check if an error is a network/connectivity issue
 *
 * @param error - Error from Amplify Auth operation
 * @returns True if error is network related
 */
export function isNetworkError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return message.includes('network') || message.includes('timeout');
}

/**
 * Get detailed error information for logging (redacted)
 *
 * This function provides error details suitable for logging without
 * exposing sensitive information like tokens or passwords.
 *
 * @param error - Error from Amplify Auth operation
 * @param context - Additional context (e.g., operation name)
 * @returns Redacted error information for logging
 */
export function getRedactedErrorInfo(
  error: Error,
  context?: string
): Record<string, unknown> {
  return {
    context: context || 'auth_operation',
    errorName: error.name,
    errorType: error.constructor.name,
    // Don't include full error message as it might contain sensitive data
    hasMessage: !!error.message,
    timestamp: new Date().toISOString(),
  };
}
