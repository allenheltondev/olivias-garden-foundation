import { describe, it, expect } from 'vitest';
import {
  mapAuthError,
  isUnverifiedError,
  isRateLimitError,
  isNetworkError,
  getRedactedErrorInfo,
} from './authErrors';

describe('authErrors', () => {
  describe('mapAuthError', () => {
    it('maps UsernameExistsException', () => {
      const error = new Error('Username exists');
      error.name = 'UsernameExistsException';

      expect(mapAuthError(error)).toBe('An account with this email already exists');
    });

    it('maps InvalidPasswordException', () => {
      const error = new Error('Invalid password');
      error.name = 'InvalidPasswordException';

      expect(mapAuthError(error)).toBe('Password does not meet requirements');
    });

    it('maps NotAuthorizedException', () => {
      const error = new Error('Not authorized');
      error.name = 'NotAuthorizedException';

      expect(mapAuthError(error)).toBe('Invalid email or password');
    });

    it('maps UserNotFoundException to same message as NotAuthorizedException', () => {
      const notAuthorizedError = new Error('Not authorized');
      notAuthorizedError.name = 'NotAuthorizedException';

      const userNotFoundError = new Error('User not found');
      userNotFoundError.name = 'UserNotFoundException';

      // Should return same message to avoid account enumeration
      expect(mapAuthError(userNotFoundError)).toBe(mapAuthError(notAuthorizedError));
      expect(mapAuthError(userNotFoundError)).toBe('Invalid email or password');
    });

    it('maps UserNotConfirmedException', () => {
      const error = new Error('User not confirmed');
      error.name = 'UserNotConfirmedException';

      expect(mapAuthError(error)).toBe('Please verify your email address');
    });

    it('maps CodeMismatchException', () => {
      const error = new Error('Code mismatch');
      error.name = 'CodeMismatchException';

      expect(mapAuthError(error)).toBe('Invalid verification code');
    });

    it('maps ExpiredCodeException', () => {
      const error = new Error('Code expired');
      error.name = 'ExpiredCodeException';

      expect(mapAuthError(error)).toBe('Verification code has expired');
    });

    it('maps LimitExceededException', () => {
      const error = new Error('Limit exceeded');
      error.name = 'LimitExceededException';

      expect(mapAuthError(error)).toBe('Too many attempts. Please try again later.');
    });

    it('maps network errors', () => {
      const error = new Error('Network error occurred');

      expect(mapAuthError(error)).toBe('Unable to connect. Please check your connection.');
    });

    it('returns generic message for unknown errors', () => {
      const error = new Error('Unknown error');
      error.name = 'UnknownException';

      expect(mapAuthError(error)).toBe('An error occurred. Please try again.');
    });
  });

  describe('Error Privacy', () => {
    it('does not reveal account existence for UserNotFoundException', () => {
      const error = new Error('User not found');
      error.name = 'UserNotFoundException';

      const message = mapAuthError(error);

      // Should not contain words like "not found", "doesn't exist", etc.
      expect(message.toLowerCase()).not.toContain('not found');
      expect(message.toLowerCase()).not.toContain('does not exist');
      expect(message.toLowerCase()).not.toContain('no account');
    });

    it('uses same message for wrong password and non-existent user', () => {
      const wrongPasswordError = new Error('Wrong password');
      wrongPasswordError.name = 'NotAuthorizedException';

      const noUserError = new Error('User not found');
      noUserError.name = 'UserNotFoundException';

      expect(mapAuthError(wrongPasswordError)).toBe(mapAuthError(noUserError));
    });
  });

  describe('isUnverifiedError', () => {
    it('returns true for UserNotConfirmedException', () => {
      const error = new Error('User not confirmed');
      error.name = 'UserNotConfirmedException';

      expect(isUnverifiedError(error)).toBe(true);
    });

    it('returns false for other errors', () => {
      const error = new Error('Other error');
      error.name = 'OtherException';

      expect(isUnverifiedError(error)).toBe(false);
    });
  });

  describe('isRateLimitError', () => {
    it('returns true for LimitExceededException', () => {
      const error = new Error('Limit exceeded');
      error.name = 'LimitExceededException';

      expect(isRateLimitError(error)).toBe(true);
    });

    it('returns true for TooManyRequestsException', () => {
      const error = new Error('Too many requests');
      error.name = 'TooManyRequestsException';

      expect(isRateLimitError(error)).toBe(true);
    });

    it('returns false for other errors', () => {
      const error = new Error('Other error');
      error.name = 'OtherException';

      expect(isRateLimitError(error)).toBe(false);
    });
  });

  describe('isNetworkError', () => {
    it('returns true for network errors', () => {
      const error = new Error('Network error occurred');

      expect(isNetworkError(error)).toBe(true);
    });

    it('returns true for timeout errors', () => {
      const error = new Error('Request timeout');

      expect(isNetworkError(error)).toBe(true);
    });

    it('returns false for other errors', () => {
      const error = new Error('Invalid password');

      expect(isNetworkError(error)).toBe(false);
    });
  });

  describe('getRedactedErrorInfo', () => {
    it('returns redacted error information', () => {
      const error = new Error('Sensitive error message with token abc123');
      error.name = 'TestException';

      const info = getRedactedErrorInfo(error, 'test_operation');

      expect(info.context).toBe('test_operation');
      expect(info.errorName).toBe('TestException');
      expect(info.errorType).toBe('Error');
      expect(info.hasMessage).toBe(true);
      expect(info.timestamp).toBeDefined();
    });

    it('does not include full error message', () => {
      const error = new Error('Sensitive data: password123, token: abc123xyz');
      error.name = 'TestException';

      const info = getRedactedErrorInfo(error);

      // Should not include the actual message
      expect(JSON.stringify(info)).not.toContain('password123');
      expect(JSON.stringify(info)).not.toContain('abc123xyz');
    });

    it('uses default context when not provided', () => {
      const error = new Error('Test error');

      const info = getRedactedErrorInfo(error);

      expect(info.context).toBe('auth_operation');
    });
  });
});
