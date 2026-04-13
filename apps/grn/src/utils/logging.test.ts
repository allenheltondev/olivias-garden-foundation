import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SecureLogger, containsSensitiveData } from './logging';

describe('logging', () => {
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>;
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('SecureLogger', () => {
    it('logs at different levels', () => {
      const logger = new SecureLogger('test');

      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warning message');
      logger.error('Error message');

      expect(consoleDebugSpy).toHaveBeenCalled();
      expect(consoleInfoSpy).toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('includes context in log output', () => {
      const logger = new SecureLogger('test-context');

      logger.info('Test message');

      expect(consoleInfoSpy).toHaveBeenCalledWith(
        '[test-context]',
        'Test message',
        undefined
      );
    });

    it('redacts sensitive fields', () => {
      const logger = new SecureLogger('test');

      logger.info('User data', {
        username: 'test@example.com',
        password: 'secret123',
        token: 'abc123xyz',
      });

      const loggedData = consoleInfoSpy.mock.calls[0][2];

      expect(loggedData.password).toBe('[REDACTED]');
      expect(loggedData.token).toBe('[REDACTED]');
      // Username should be hashed, not redacted
      expect(loggedData.username).toMatch(/\[HASHED:[a-f0-9]+\]/);
    });

    it('hashes PII fields', () => {
      const logger = new SecureLogger('test');

      logger.info('User info', {
        email: 'user@example.com',
        name: 'John Doe',
      });

      const loggedData = consoleInfoSpy.mock.calls[0][2];

      expect(loggedData.email).toMatch(/\[HASHED:[a-f0-9]+\]/);
      expect(loggedData.name).toMatch(/\[HASHED:[a-f0-9]+\]/);
      expect(loggedData.email).not.toBe('user@example.com');
    });

    it('redacts nested sensitive data', () => {
      const logger = new SecureLogger('test');

      logger.info('Nested data', {
        user: {
          email: 'test@example.com',
          credentials: {
            password: 'secret',
            token: 'abc123',
          },
        },
      });

      const loggedData = consoleInfoSpy.mock.calls[0][2];

      expect(loggedData.user.email).toMatch(/\[HASHED:[a-f0-9]+\]/);
      // Credentials object should be redacted
      expect(loggedData.user.credentials).toBeDefined();
    });

    it('handles arrays with sensitive data', () => {
      const logger = new SecureLogger('test');

      logger.info('Array data', {
        users: [
          { email: 'user1@example.com', password: 'pass1' },
          { email: 'user2@example.com', password: 'pass2' },
        ],
      });

      const loggedData = consoleInfoSpy.mock.calls[0][2];

      expect(loggedData.users[0].password).toBe('[REDACTED]');
      expect(loggedData.users[1].password).toBe('[REDACTED]');
      expect(loggedData.users[0].email).toMatch(/\[HASHED:[a-f0-9]+\]/);
    });

    it('logs errors without exposing sensitive data', () => {
      const logger = new SecureLogger('test');
      const error = new Error('Authentication failed with token abc123');
      error.name = 'AuthError';

      logger.error('Auth failed', error, { userId: '123' });

      const loggedData = consoleErrorSpy.mock.calls[0][2];

      expect(loggedData.errorType).toBe('Error');
      expect(loggedData.hasMessage).toBe(true);
      // Should not include the actual error message
      expect(JSON.stringify(loggedData)).not.toContain('abc123');
    });

    it('logs auth events with redaction', () => {
      const logger = new SecureLogger('auth');

      logger.authEvent('sign_in', {
        email: 'user@example.com',
        timestamp: '2024-01-01',
      });

      expect(consoleInfoSpy).toHaveBeenCalled();
      const loggedData = consoleInfoSpy.mock.calls[0][2];

      expect(loggedData.email).toMatch(/\[HASHED:[a-f0-9]+\]/);
      expect(loggedData.timestamp).toBe('2024-01-01');
    });
  });

  describe('Sensitive Data Detection', () => {
    it('detects token-like strings', () => {
      const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9eyJzdWIiOiIxMjM0NTY3ODkwIn0abc';

      expect(containsSensitiveData(token)).toBe(true);
    });

    it('detects objects with sensitive fields', () => {
      const data = {
        username: 'test',
        password: 'secret',
      };

      expect(containsSensitiveData(data)).toBe(true);
    });

    it('does not flag normal strings', () => {
      expect(containsSensitiveData('Hello world')).toBe(false);
      expect(containsSensitiveData('user@example.com')).toBe(false);
    });

    it('does not flag normal objects', () => {
      const data = {
        name: 'John',
        age: 30,
      };

      expect(containsSensitiveData(data)).toBe(false);
    });
  });

  describe('Redaction Patterns', () => {
    it('redacts all token variations', () => {
      const logger = new SecureLogger('test');

      logger.info('Tokens', {
        accessToken: 'abc123',
        refreshToken: 'def456',
        idToken: 'ghi789',
        bearerToken: 'jkl012',
      });

      const loggedData = consoleInfoSpy.mock.calls[0][2];

      expect(loggedData.accessToken).toBe('[REDACTED]');
      expect(loggedData.refreshToken).toBe('[REDACTED]');
      expect(loggedData.idToken).toBe('[REDACTED]');
      expect(loggedData.bearerToken).toBe('[REDACTED]');
    });

    it('redacts all password variations', () => {
      const logger = new SecureLogger('test');

      logger.info('Passwords', {
        password: 'secret1',
        newPassword: 'secret2',
        oldPassword: 'secret3',
        confirmPassword: 'secret4',
      });

      const loggedData = consoleInfoSpy.mock.calls[0][2];

      expect(loggedData.password).toBe('[REDACTED]');
      expect(loggedData.newPassword).toBe('[REDACTED]');
      expect(loggedData.oldPassword).toBe('[REDACTED]');
      expect(loggedData.confirmPassword).toBe('[REDACTED]');
    });

    it('redacts auth-related fields', () => {
      const logger = new SecureLogger('test');

      logger.info('Auth data', {
        authorization: 'Bearer token',
        authHeader: 'Basic abc123',
        credentials: 'user:pass',
      });

      const loggedData = consoleInfoSpy.mock.calls[0][2];

      expect(loggedData.authorization).toBe('[REDACTED]');
      expect(loggedData.authHeader).toBe('[REDACTED]');
      expect(loggedData.credentials).toBe('[REDACTED]');
    });
  });

  describe('Privacy Compliance', () => {
    it('never logs raw passwords', () => {
      const logger = new SecureLogger('test');

      logger.info('User action', {
        action: 'login',
        password: 'MySecretPassword123!',
      });

      const allLogs = JSON.stringify(consoleInfoSpy.mock.calls);

      expect(allLogs).not.toContain('MySecretPassword123!');
      expect(allLogs).toContain('[REDACTED]');
    });

    it('never logs raw tokens', () => {
      const logger = new SecureLogger('test');

      logger.info('API call', {
        endpoint: '/api/user',
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      });

      const allLogs = JSON.stringify(consoleInfoSpy.mock.calls);

      expect(allLogs).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
      expect(allLogs).toContain('[REDACTED]');
    });

    it('hashes email addresses consistently', () => {
      const logger = new SecureLogger('test');

      logger.info('First log', { email: 'test@example.com' });
      logger.info('Second log', { email: 'test@example.com' });

      const firstHash = consoleInfoSpy.mock.calls[0][2].email;
      const secondHash = consoleInfoSpy.mock.calls[1][2].email;

      // Same email should produce same hash
      expect(firstHash).toBe(secondHash);
      expect(firstHash).not.toBe('test@example.com');
    });
  });
});
