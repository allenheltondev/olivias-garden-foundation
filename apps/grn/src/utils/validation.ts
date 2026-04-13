/**
 * Validation utilities for form inputs
 */

/**
 * Validates email format using a pragmatic regex suitable for UI validation.
 * This is not overly strict - it accepts most common email formats.
 *
 * @param email - The email string to validate
 * @returns true if the email format is valid, false otherwise
 *
 * Requirements: 1.6
 */
export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') {
    return false;
  }

  // Pragmatic email regex for UI validation
  // Accepts: local-part@domain with reasonable character sets
  // Not overly strict - focuses on common valid formats
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  return emailRegex.test(email.trim());
}

/**
 * Password validation result with specific error messages
 */
export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Validates password against Cognito password policy for V1.
 * Requirements: minimum 8 characters, at least one uppercase letter,
 * at least one lowercase letter, and at least one number.
 *
 * @param password - The password string to validate
 * @returns Validation result with specific error messages
 *
 * Requirements: 1.3, 1.7, 3.4
 */
export function validatePassword(password: string): PasswordValidationResult {
  const errors: string[] = [];

  if (!password || typeof password !== 'string') {
    return {
      isValid: false,
      errors: ['Password is required'],
    };
  }

  // Check minimum length (8 characters)
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters');
  }

  // Check for at least one uppercase letter
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  // Check for at least one lowercase letter
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  // Check for at least one number
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
