/**
 * Property-Based Tests for Error Message Privacy
 *
 * Feature: ui-auth-and-theme
 * Property 4: Error messages do not reveal account existence
 *
 * **Validates: Requirements 2.3, 3.7, 13.4**
 *
 * This test uses property-based testing to verify that authentication error
 * messages never reveal whether an email address or account exists in the system.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { mapAuthError } from '../../utils/authErrors';

describe('Property-Based Tests: Error Message Privacy', () => {
  describe('Property 4: Error messages do not reveal account existence', () => {
    it('should return same message for UserNotFoundException and NotAuthorizedException', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }),
          (errorMessage) => {
            const userNotFoundError = new Error(errorMessage);
            userNotFoundError.name = 'UserNotFoundException';

            const notAuthorizedError = new Error(errorMessage);
            notAuthorizedError.name = 'NotAuthorizedException';

            const message1 = mapAuthError(userNotFoundError);
            const message2 = mapAuthError(notAuthorizedError);

            // Both should return the same generic message
            expect(message1).toBe(message2);
            expect(message1).toBe('Invalid email or password');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should never mention "not found" or "does not exist" in error messages', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(
            'UserNotFoundException',
            'NotAuthorizedException',
            'InvalidPasswordException',
            'CodeMismatchException',
            'ExpiredCodeException'
          ),
          fc.string({ minLength: 1, maxLength: 100 }),
          (errorName, errorMessage) => {
            const error = new Error(errorMessage);
            error.name = errorName;

            const mappedMessage = mapAuthError(error);

            // Error message should not reveal account existence
            expect(mappedMessage.toLowerCase()).not.toContain('not found');
            expect(mappedMessage.toLowerCase()).not.toContain('does not exist');
            expect(mappedMessage.toLowerCase()).not.toContain('doesn\'t exist');
            expect(mappedMessage.toLowerCase()).not.toContain('no account');
            expect(mappedMessage.toLowerCase()).not.toContain('no user');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should never mention specific email addresses in error messages', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(
            'UserNotFoundException',
            'NotAuthorizedException',
            'UsernameExistsException'
          ),
          fc.emailAddress(),
          (errorName, email) => {
            const error = new Error(`Error for ${email}`);
            error.name = errorName;

            const mappedMessage = mapAuthError(error);

            // Error message should not contain the email address
            expect(mappedMessage).not.toContain(email);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return generic messages for password reset on non-existent accounts', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }),
          (errorMessage) => {
            const error = new Error(errorMessage);
            error.name = 'UserNotFoundException';

            const mappedMessage = mapAuthError(error);

            // Should use same message as wrong password
            expect(mappedMessage).toBe('Invalid email or password');
            // Should not reveal that account doesn't exist
            expect(mappedMessage.toLowerCase()).not.toContain('not found');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should never reveal account existence through different error types', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.string({ minLength: 1, maxLength: 100 }),
            fc.string({ minLength: 1, maxLength: 100 })
          ),
          ([message1, message2]) => {
            const userNotFoundError = new Error(message1);
            userNotFoundError.name = 'UserNotFoundException';

            const wrongPasswordError = new Error(message2);
            wrongPasswordError.name = 'NotAuthorizedException';

            const mappedMessage1 = mapAuthError(userNotFoundError);
            const mappedMessage2 = mapAuthError(wrongPasswordError);

            // Both authentication failures should return identical messages
            expect(mappedMessage1).toBe(mappedMessage2);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not leak information through error message length variations', () => {
      fc.assert(
        fc.property(
          fc.array(fc.string({ minLength: 1, maxLength: 200 }), { minLength: 5, maxLength: 10 }),
          (errorMessages) => {
            const messages = errorMessages.map(msg => {
              const error = new Error(msg);
              error.name = 'UserNotFoundException';
              return mapAuthError(error);
            });

            // All UserNotFoundException errors should map to the same message
            const uniqueMessages = new Set(messages);
            expect(uniqueMessages.size).toBe(1);
            expect(uniqueMessages.has('Invalid email or password')).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle various authentication error names without revealing existence', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(
            'UserNotFoundException',
            'NotAuthorizedException',
            'InvalidPasswordException'
          ),
          (errorName) => {
            const error = new Error('Authentication failed');
            error.name = errorName;

            const mappedMessage = mapAuthError(error);

            // Should not contain words that reveal account status
            const sensitiveWords = ['exists', 'found', 'registered', 'known', 'unknown'];
            const lowerMessage = mappedMessage.toLowerCase();

            sensitiveWords.forEach(word => {
              expect(lowerMessage).not.toContain(word);
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return consistent messages regardless of error message content', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 500 }),
          (errorContent) => {
            const error1 = new Error(errorContent);
            error1.name = 'NotAuthorizedException';

            const error2 = new Error('Different message');
            error2.name = 'NotAuthorizedException';

            // Same error type should always produce same mapped message
            expect(mapAuthError(error1)).toBe(mapAuthError(error2));
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should never expose raw Cognito error messages', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(
            'UserNotFoundException',
            'NotAuthorizedException',
            'UsernameExistsException',
            'InvalidPasswordException'
          ),
          fc.string({ minLength: 10, maxLength: 200 }),
          (errorName, rawMessage) => {
            const error = new Error(rawMessage);
            error.name = errorName;

            const mappedMessage = mapAuthError(error);

            // Mapped message should be curated, not the raw Cognito message
            // (unless by coincidence they match, which is unlikely with random strings)
            if (rawMessage.length > 50) {
              expect(mappedMessage).not.toBe(rawMessage);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should provide actionable messages without revealing account details', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(
            'UserNotFoundException',
            'NotAuthorizedException',
            'UserNotConfirmedException'
          ),
          (errorName) => {
            const error = new Error('Auth error');
            error.name = errorName;

            const mappedMessage = mapAuthError(error);

            // Message should be helpful but not reveal account existence
            expect(mappedMessage.length).toBeGreaterThan(0);
            expect(mappedMessage).not.toContain('account exists');
            expect(mappedMessage).not.toContain('account not found');
            expect(mappedMessage).not.toContain('user exists');
            expect(mappedMessage).not.toContain('user not found');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Sanity check: Known error mappings', () => {
    it('should map known errors correctly', () => {
      const testCases = [
        { name: 'UserNotFoundException', expected: 'Invalid email or password' },
        { name: 'NotAuthorizedException', expected: 'Invalid email or password' },
        { name: 'UsernameExistsException', expected: 'An account with this email already exists' },
        { name: 'UserNotConfirmedException', expected: 'Please verify your email address' },
        { name: 'CodeMismatchException', expected: 'Invalid verification code' },
      ];

      testCases.forEach(({ name, expected }) => {
        const error = new Error('Test error');
        error.name = name;
        expect(mapAuthError(error)).toBe(expected);
      });
    });

    it('should ensure UserNotFoundException and NotAuthorizedException return identical messages', () => {
      const error1 = new Error('User not found');
      error1.name = 'UserNotFoundException';

      const error2 = new Error('Wrong password');
      error2.name = 'NotAuthorizedException';

      expect(mapAuthError(error1)).toBe(mapAuthError(error2));
    });
  });
});
