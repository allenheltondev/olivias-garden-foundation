/**
 * Property-Based Tests for Sensitive Data Logging
 *
 * Feature: ui-auth-and-theme
 * Property 3: Sensitive data is never logged
 *
 * **Validates: Requirements 13.1**
 *
 * This test uses property-based testing to verify that the logging system
 * never logs sensitive data (tokens, passwords, secrets) to the console
 * across all authentication operations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { SecureLogger, containsSensitiveData } from '../../utils/logging';

describe('Property-Based Tests: Sensitive Data Logging', () => {
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Property 3: Sensitive data is never logged', () => {
    it('should never log raw passwords regardless of field name variation', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 8, maxLength: 50 }),
          fc.constantFrom('password', 'Password', 'newPassword', 'oldPassword'),
          (passwordValue, fieldName) => {
            const logger = new SecureLogger('test');
            logger.info('Auth operation', { [fieldName]: passwordValue });
            const allLogs = JSON.stringify(consoleInfoSpy.mock.calls);
            expect(allLogs).not.toContain(passwordValue);
            expect(allLogs).toContain('[REDACTED]');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should never log raw tokens regardless of field name variation', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 20, maxLength: 100 }).filter(s => /^[A-Za-z0-9+/=_-]+$/.test(s)),
          fc.constantFrom('token', 'accessToken', 'refreshToken', 'idToken'),
          (tokenValue, fieldName) => {
            const logger = new SecureLogger('test');
            logger.info('Auth operation', { [fieldName]: tokenValue });
            const allLogs = JSON.stringify(consoleInfoSpy.mock.calls);
            expect(allLogs).not.toContain(tokenValue);
            expect(allLogs).toContain('[REDACTED]');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should never log secrets regardless of field name variation', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 10, maxLength: 50 }),
          fc.constantFrom('secret', 'clientSecret', 'apiSecret'),
          (secretValue, fieldName) => {
            const logger = new SecureLogger('test');
            logger.info('Auth operation', { [fieldName]: secretValue });
            const allLogs = JSON.stringify(consoleInfoSpy.mock.calls);
            expect(allLogs).not.toContain(secretValue);
            expect(allLogs).toContain('[REDACTED]');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should never log credentials', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 10, maxLength: 50 }),
          (credentialValue) => {
            const logger = new SecureLogger('test');
            logger.info('Auth operation', { credentials: credentialValue });
            const allLogs = JSON.stringify(consoleInfoSpy.mock.calls);
            expect(allLogs).not.toContain(credentialValue);
            expect(allLogs).toContain('[REDACTED]');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should never log sensitive data in nested objects', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 8, maxLength: 50 }),
          fc.string({ minLength: 20, maxLength: 100 }).filter(s => /^[A-Za-z0-9+/=_-]+$/.test(s)),
          (password, token) => {
            const logger = new SecureLogger('test');
            const data = { user: { credentials: { password: password, token: token } } };
            logger.info('Nested auth data', data);
            const allLogs = JSON.stringify(consoleInfoSpy.mock.calls);
            expect(allLogs).not.toContain(password);
            expect(allLogs).not.toContain(token);
            expect(allLogs).toContain('[REDACTED]');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should never log sensitive data across all log levels', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 8, maxLength: 50 }),
          fc.constantFrom('info', 'warn', 'error', 'debug'),
          (password, logLevel) => {
            const logger = new SecureLogger('test');
            const data = { password: password };
            if (logLevel === 'info') {
              logger.info('Test', data);
            } else if (logLevel === 'warn') {
              logger.warn('Test', data);
            } else if (logLevel === 'error') {
              logger.error('Test', undefined, data);
            } else {
              logger.debug('Test', data);
            }
            const allLogs = JSON.stringify([
              ...consoleInfoSpy.mock.calls,
              ...consoleWarnSpy.mock.calls,
              ...consoleErrorSpy.mock.calls,
              ...consoleDebugSpy.mock.calls,
            ]);
            expect(allLogs).not.toContain(password);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should never log authorization headers', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 20, maxLength: 100 }),
          (authValue) => {
            const logger = new SecureLogger('test');
            logger.info('API request', { authorization: authValue });
            const allLogs = JSON.stringify(consoleInfoSpy.mock.calls);
            expect(allLogs).not.toContain(authValue);
            expect(allLogs).toContain('[REDACTED]');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should never log session identifiers', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 20, maxLength: 100 }),
          (sessionValue) => {
            const logger = new SecureLogger('test');
            logger.info('Session operation', { session: sessionValue });
            const allLogs = JSON.stringify(consoleInfoSpy.mock.calls);
            expect(allLogs).not.toContain(sessionValue);
            expect(allLogs).toContain('[REDACTED]');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should never log API keys', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 20, maxLength: 100 }),
          (keyValue) => {
            const logger = new SecureLogger('test');
            logger.info('API operation', { apiKey: keyValue });
            const allLogs = JSON.stringify(consoleInfoSpy.mock.calls);
            expect(allLogs).not.toContain(keyValue);
            expect(allLogs).toContain('[REDACTED]');
          }
        ),
        { numRuns: 100 }
      );
    });
    it('should detect token-like strings as sensitive', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 21, maxLength: 100 }),
          (baseString) => {
            const tokenLikeString = baseString.replace(/[^A-Za-z0-9+/=_-]/g, 'A');
            if (tokenLikeString.length > 20 && /^[A-Za-z0-9+/=_-]+$/.test(tokenLikeString)) {
              expect(containsSensitiveData(tokenLikeString)).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should detect objects with sensitive fields', () => {
      fc.assert(
        fc.property(
          fc.record({
            username: fc.string({ minLength: 3, maxLength: 20 }),
            password: fc.string({ minLength: 8, maxLength: 50 }),
          }),
          (authData) => {
            expect(containsSensitiveData(authData)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should never log sensitive data in auth events', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 8, maxLength: 50 }),
          fc.constantFrom('sign_in', 'sign_up', 'password_reset'),
          (password, eventName) => {
            const logger = new SecureLogger('auth');
            logger.authEvent(eventName, { password: password });
            const allLogs = JSON.stringify(consoleInfoSpy.mock.calls);
            expect(allLogs).not.toContain(password);
            expect(allLogs).toContain('[REDACTED]');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should never log sensitive data in error contexts', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 8, maxLength: 50 }),
          (password) => {
            const logger = new SecureLogger('test');
            const error = new Error('Auth failed');
            logger.error('Authentication error', error, { password: password });
            const allLogs = JSON.stringify(consoleErrorSpy.mock.calls);
            expect(allLogs).not.toContain(password);
            expect(allLogs).toContain('[REDACTED]');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Sanity check: Non-sensitive data should be logged', () => {
    it('should log non-sensitive fields normally', () => {
      const logger = new SecureLogger('test');
      logger.info('User action', {
        action: 'login',
        timestamp: '2024-01-01',
      });
      const allLogs = JSON.stringify(consoleInfoSpy.mock.calls);
      expect(allLogs).toContain('login');
      expect(allLogs).toContain('2024-01-01');
    });
  });
});
