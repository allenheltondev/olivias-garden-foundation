/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect } from 'vitest';
import { isValidEmail, validatePassword } from './validation';

describe('isValidEmail', () => {
  it('should accept valid email addresses', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail('test.user@domain.co.uk')).toBe(true);
    expect(isValidEmail('user+tag@example.com')).toBe(true);
  });

  it('should reject invalid email addresses', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('notanemail')).toBe(false);
    expect(isValidEmail('missing@domain')).toBe(false);
    expect(isValidEmail('@nodomain.com')).toBe(false);
    expect(isValidEmail('user@')).toBe(false);
  });

  it('should handle edge cases', () => {
    expect(isValidEmail('  user@example.com  ')).toBe(true); // trims whitespace
    expect(isValidEmail('user @example.com')).toBe(false); // space in email
  });
});

describe('validatePassword', () => {
  it('should accept valid passwords', () => {
    const result = validatePassword('Password123');
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject password shorter than 8 characters', () => {
    const result = validatePassword('Pass1');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Password must be at least 8 characters');
  });

  it('should reject password without uppercase letter', () => {
    const result = validatePassword('password123');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Password must contain at least one uppercase letter');
  });

  it('should reject password without lowercase letter', () => {
    const result = validatePassword('PASSWORD123');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Password must contain at least one lowercase letter');
  });

  it('should reject password without number', () => {
    const result = validatePassword('PasswordOnly');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Password must contain at least one number');
  });

  it('should return multiple errors for password with multiple issues', () => {
    const result = validatePassword('pass');
    expect(result.isValid).toBe(false);
    expect(result.errors).toHaveLength(3);
    expect(result.errors).toContain('Password must be at least 8 characters');
    expect(result.errors).toContain('Password must contain at least one uppercase letter');
    expect(result.errors).toContain('Password must contain at least one number');
  });

  it('should handle empty or null password', () => {
    const result1 = validatePassword('');
    expect(result1.isValid).toBe(false);
    expect(result1.errors).toContain('Password is required');

    const result2 = validatePassword(null as any);
    expect(result2.isValid).toBe(false);
    expect(result2.errors).toContain('Password is required');
  });

  it('should accept password with special characters', () => {
    const result = validatePassword('Password123!@#');
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should accept password exactly 8 characters', () => {
    const result = validatePassword('Pass1234');
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
