/**
 * Property-Based Tests for Email Validation
 *
 * Feature: ui-auth-and-theme
 * Property 1: Email validation rejects clearly invalid formats
 *
 * **Validates: Requirements 1.6**
 *
 * This test uses property-based testing to verify that the email validation
 * function correctly rejects invalid email formats across a wide range of inputs.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { isValidEmail } from '../../utils/validation';

describe('Property-Based Tests: Email Validation', () => {
  describe('Property 1: Email validation rejects clearly invalid formats', () => {
    it('should reject emails without @ symbol', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }).filter(s => !s.includes('@')),
          (invalidEmail) => {
            expect(isValidEmail(invalidEmail)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject emails with multiple @ symbols', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.string({ minLength: 1, maxLength: 20 }),
            fc.string({ minLength: 1, maxLength: 20 }),
            fc.string({ minLength: 1, maxLength: 20 })
          ),
          ([part1, part2, part3]) => {
            const invalidEmail = `${part1}@${part2}@${part3}`;
            expect(isValidEmail(invalidEmail)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject emails without domain extension', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes('@') && !s.includes('.')),
            fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes('@') && !s.includes('.'))
          ),
          ([localPart, domain]) => {
            const invalidEmail = `${localPart}@${domain}`;
            expect(isValidEmail(invalidEmail)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject emails with internal whitespace in local part', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.string({ minLength: 1, maxLength: 10 }).filter(s => !s.includes('@') && !s.includes(' ') && !s.includes('\t') && !s.includes('\n')),
            fc.constantFrom(' ', '\t', '\n'),
            fc.string({ minLength: 1, maxLength: 10 }).filter(s => !s.includes('@') && !s.includes(' ') && !s.includes('\t') && !s.includes('\n'))
          ),
          ([before, whitespace, after]) => {
            // Create email with whitespace in the middle of local part
            const invalidEmail = `${before}${whitespace}${after}@example.com`;
            expect(isValidEmail(invalidEmail)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject empty strings and whitespace-only strings', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('', ' ', '  ', '\t', '\n', '   \t\n'),
          (invalidEmail) => {
            expect(isValidEmail(invalidEmail)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject emails starting or ending with @', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }),
          (str) => {
            expect(isValidEmail(`@${str}`)).toBe(false);
            expect(isValidEmail(`${str}@`)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject emails with missing local part', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes('@')),
            fc.string({ minLength: 1, maxLength: 10 }).filter(s => !s.includes('@'))
          ),
          ([domain, extension]) => {
            const invalidEmail = `@${domain}.${extension}`;
            expect(isValidEmail(invalidEmail)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject emails with missing domain', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes('@') && !s.includes('.')),
          (localPart) => {
            const invalidEmail = `${localPart}@`;
            expect(isValidEmail(invalidEmail)).toBe(false);
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
            fc.constant(null),
            fc.constant(undefined),
            fc.object()
          ),
          (nonString) => {
            // @ts-expect-error - Testing invalid input types
            expect(isValidEmail(nonString)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Sanity check: Valid emails should pass', () => {
    it('should accept common valid email formats', () => {
      const validEmails = [
        'user@example.com',
        'test.user@example.com',
        'user+tag@example.co.uk',
        'user_name@example-domain.com',
        'a@b.c',
        '123@456.789'
      ];

      validEmails.forEach(email => {
        expect(isValidEmail(email)).toBe(true);
      });
    });
  });
});
