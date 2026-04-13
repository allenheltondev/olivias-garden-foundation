/**
 * Property-Based Tests for Password Validation
 *
 * Feature: ui-auth-and-theme
 * Property 2: Password validation matches Cognito password policy configured for V1
 *
 * **Validates: Requirements 1.3, 1.7, 3.4**
 *
 * This test uses property-based testing to verify that the password validation
 * function correctly enforces the Cognito V1 password policy:
 * - Minimum 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validatePassword } from '../../utils/validation';

describe('Property-Based Tests: Password Validation', () => {
  describe('Property 2: Password validation matches Cognito password policy configured for V1', () => {
    it('should reject passwords shorter than 8 characters', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 7 }),
          (shortPassword) => {
            const result = validatePassword(shortPassword);
            expect(result.isValid).toBe(false);
            expect(result.errors.some(err => err.includes('at least 8 characters'))).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject passwords without uppercase letters', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 8, maxLength: 20 }),
          (password) => {
            // Create password with lowercase and number but no uppercase
            const passwordWithRequirements = password.toLowerCase().replace(/[A-Z]/g, 'a') + 'abc1';
            if (passwordWithRequirements.length >= 8 && /[a-z]/.test(passwordWithRequirements) && /[0-9]/.test(passwordWithRequirements) && !/[A-Z]/.test(passwordWithRequirements)) {
              const result = validatePassword(passwordWithRequirements);
              expect(result.isValid).toBe(false);
              expect(result.errors.some(err => err.includes('uppercase letter'))).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject passwords without lowercase letters', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 8, maxLength: 20 }),
          (password) => {
            // Create password with uppercase and number but no lowercase
            const passwordWithRequirements = password.toUpperCase().replace(/[a-z]/g, 'A') + 'ABC1';
            if (passwordWithRequirements.length >= 8 && /[A-Z]/.test(passwordWithRequirements) && /[0-9]/.test(passwordWithRequirements) && !/[a-z]/.test(passwordWithRequirements)) {
              const result = validatePassword(passwordWithRequirements);
              expect(result.isValid).toBe(false);
              expect(result.errors.some(err => err.includes('lowercase letter'))).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject passwords without numbers', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 8, maxLength: 20 }),
          (password) => {
            // Create password with uppercase and lowercase but no number
            const passwordWithRequirements = 'Aa' + password.replace(/[0-9]/g, 'x');
            if (passwordWithRequirements.length >= 8 && /[A-Z]/.test(passwordWithRequirements) && /[a-z]/.test(passwordWithRequirements) && !/[0-9]/.test(passwordWithRequirements)) {
              const result = validatePassword(passwordWithRequirements);
              expect(result.isValid).toBe(false);
              expect(result.errors.some(err => err.includes('number'))).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should accept passwords meeting all requirements', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.string({ minLength: 5, maxLength: 15 }),
            fc.integer({ min: 0, max: 9 })
          ),
          ([basePassword, number]) => {
            // Construct a password that meets all requirements
            const validPassword = `Aa${number}${basePassword}`;
            if (validPassword.length >= 8) {
              const result = validatePassword(validPassword);
              expect(result.isValid).toBe(true);
              expect(result.errors).toHaveLength(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject empty or null passwords', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('', null, undefined),
          (invalidPassword) => {
            // @ts-expect-error - Testing invalid input types
            const result = validatePassword(invalidPassword);
            expect(result.isValid).toBe(false);
            expect(result.errors.some(err => err.includes('required'))).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject non-string inputs', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.integer(),
            fc.boolean(),
            fc.object()
          ),
          (nonString) => {
            // @ts-expect-error - Testing invalid input types
            const result = validatePassword(nonString);
            expect(result.isValid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should validate that exactly meeting minimum length with all requirements passes', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), { minLength: 6, maxLength: 6 }),
            fc.integer({ min: 0, max: 9 })
          ),
          ([lowerChars, number]) => {
            // Create exactly 8 character password: 1 upper + 1 number + 6 lower = 8
            const lowerPart = lowerChars.join('');
            const validPassword = `A${number}${lowerPart}`;
            expect(validPassword.length).toBe(8);
            const result = validatePassword(validPassword);
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should accumulate multiple validation errors', () => {
      fc.assert(
        fc.property(
          fc.string({ maxLength: 5 }),
          (shortPassword) => {
            // Short password likely missing multiple requirements
            const result = validatePassword(shortPassword);
            expect(result.isValid).toBe(false);
            // Should have at least the length error
            expect(result.errors.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle passwords with special characters correctly', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.array(fc.constantFrom(...'!@#$%^&*()_+-=[]{}|;:,.<>?'.split('')), { minLength: 3, maxLength: 10 }),
            fc.integer({ min: 0, max: 9 })
          ),
          ([specialCharsArray, number]) => {
            // Special characters should not affect validation (not required, but allowed)
            const specialChars = specialCharsArray.join('');
            const validPassword = `Aa${number}${specialChars}`;
            if (validPassword.length >= 8) {
              const result = validatePassword(validPassword);
              expect(result.isValid).toBe(true);
              expect(result.errors).toHaveLength(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Sanity check: Known valid and invalid passwords', () => {
    it('should accept known valid passwords', () => {
      const validPasswords = [
        'Password1',
        'Test1234',
        'Abcdefg1',
        'MyP@ssw0rd',
        'Secure123!',
        'ValidPass1'
      ];

      validPasswords.forEach(password => {
        const result = validatePassword(password);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    it('should reject known invalid passwords', () => {
      const invalidPasswords = [
        { password: 'short1A', expectedError: 'at least 8 characters' },
        { password: 'nouppercase1', expectedError: 'uppercase letter' },
        { password: 'NOLOWERCASE1', expectedError: 'lowercase letter' },
        { password: 'NoNumbers', expectedError: 'number' },
        { password: 'abc', expectedError: 'at least 8 characters' }
      ];

      invalidPasswords.forEach(({ password, expectedError }) => {
        const result = validatePassword(password);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(err => err.includes(expectedError))).toBe(true);
      });
    });
  });
});
