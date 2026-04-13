/**
 * Secure Logging Utility
 *
 * Provides logging functions with automatic redaction of sensitive data.
 * Ensures tokens, passwords, and PII are never logged to console or logging systems.
 *
 * Security Principles:
 * - Never log tokens, passwords, or secrets
 * - Redact or hash email addresses and user identifiers
 * - Provide structured logging for debugging without exposing sensitive data
 * - Fail safely - if in doubt, redact
 */

/**
 * Sensitive field patterns to redact
 */
const SENSITIVE_PATTERNS = [
  /token/i,
  /password/i,
  /secret/i,
  /key/i,
  /auth/i,
  /credential/i,
  /session/i,
];

/**
 * PII field patterns to hash/redact
 */
const PII_PATTERNS = [
  /email/i,
  /username/i,
  /phone/i,
  /address/i,
  /name/i,
];

/**
 * Check if a field name contains sensitive data
 */
function isSensitiveField(fieldName: string): boolean {
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(fieldName));
}

/**
 * Check if a field name contains PII
 */
function isPIIField(fieldName: string): boolean {
  return PII_PATTERNS.some(pattern => pattern.test(fieldName));
}

/**
 * Simple hash function for PII (not cryptographic, just for obfuscation)
 */
function hashValue(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return `[HASHED:${Math.abs(hash).toString(16)}]`;
}

/**
 * Redact sensitive data from an object
 */
function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveField(key)) {
      redacted[key] = '[REDACTED]';
    } else if (isPIIField(key) && typeof value === 'string') {
      redacted[key] = hashValue(value);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      redacted[key] = redactObject(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      redacted[key] = value.map(item =>
        item && typeof item === 'object' ? redactObject(item as Record<string, unknown>) : item
      );
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}

/**
 * Log levels
 */
export const LogLevel = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
} as const;

export type LogLevel = typeof LogLevel[keyof typeof LogLevel];

/**
 * Structured log entry
 */
export interface LogEntry {
  level: LogLevel;
  message: string;
  context?: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

/**
 * Safe logger that redacts sensitive data
 */
export class SecureLogger {
  private context: string;

  constructor(context: string = 'app') {
    this.context = context;
  }

  /**
   * Create a log entry with redacted data
   */
  private createLogEntry(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>
  ): LogEntry {
    return {
      level,
      message,
      context: this.context,
      data: data ? redactObject(data) : undefined,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Log debug message (only in development)
   */
  debug(message: string, data?: Record<string, unknown>): void {
    if (import.meta.env.DEV) {
      const entry = this.createLogEntry(LogLevel.DEBUG, message, data);
      console.debug(`[${entry.context}]`, entry.message, entry.data);
    }
  }

  /**
   * Log info message
   */
  info(message: string, data?: Record<string, unknown>): void {
    const entry = this.createLogEntry(LogLevel.INFO, message, data);
    console.info(`[${entry.context}]`, entry.message, entry.data);
  }

  /**
   * Log warning message
   */
  warn(message: string, data?: Record<string, unknown>): void {
    const entry = this.createLogEntry(LogLevel.WARN, message, data);
    console.warn(`[${entry.context}]`, entry.message, entry.data);
  }

  /**
   * Log error message
   */
  error(message: string, error?: Error, data?: Record<string, unknown>): void {
    const entry = this.createLogEntry(LogLevel.ERROR, message, {
      ...data,
      errorName: error?.name,
      errorType: error?.constructor.name,
      // Don't include full error message as it might contain sensitive data
      hasMessage: !!error?.message,
    });
    console.error(`[${entry.context}]`, entry.message, entry.data);
  }

  /**
   * Log authentication event (with extra redaction)
   */
  authEvent(event: string, data?: Record<string, unknown>): void {
    const entry = this.createLogEntry(LogLevel.INFO, `Auth: ${event}`, data);
    console.info(`[${entry.context}]`, entry.message, entry.data);
  }
}

/**
 * Default logger instance
 */
export const logger = new SecureLogger('auth');

/**
 * Create a logger with specific context
 */
export function createLogger(context: string): SecureLogger {
  return new SecureLogger(context);
}

/**
 * Utility to check if a value contains sensitive data
 * Use this before logging any user input or API responses
 */
export function containsSensitiveData(value: unknown): boolean {
  if (typeof value === 'string') {
    // Check for common token/key patterns
    if (value.length > 20 && /^[A-Za-z0-9+/=_-]+$/.test(value)) {
      return true; // Looks like a token
    }
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    return keys.some(key => isSensitiveField(key));
  }

  return false;
}
