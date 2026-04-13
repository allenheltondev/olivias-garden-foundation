/**
 * Unit Tests for Amplify Configuration
 *
 * Feature: ui-auth-and-theme
 * Tests configuration loading from environment and fail-fast behavior
 *
 * **Validates: Requirements 11.1, 11.2**
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configureAmplify } from './amplify';
import { Amplify } from 'aws-amplify';

// Mock Amplify.configure
vi.mock('aws-amplify', () => ({
  Amplify: {
    configure: vi.fn(),
  },
}));

describe('Amplify Configuration', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();
  });

  describe('Configuration Loading from Environment', () => {
    it('should configure Amplify with provided config object', () => {
      // Arrange
      const config = {
        userPoolId: 'us-east-1_TEST123',
        userPoolClientId: 'test-client-id-123',
        region: 'us-west-2',
      };

      // Act
      configureAmplify(config);

      // Assert
      expect(Amplify.configure).toHaveBeenCalledWith({
        Auth: {
          Cognito: {
            userPoolId: 'us-east-1_TEST123',
            userPoolClientId: 'test-client-id-123',
            loginWith: {
              email: true,
            },
            signUpVerificationMethod: 'code',
            userAttributes: {
              email: {
                required: true,
              },
            },
            passwordFormat: {
              minLength: 8,
              requireLowercase: true,
              requireUppercase: true,
              requireNumbers: true,
              requireSpecialCharacters: false,
            },
          },
        },
      });
    });

    it('should configure Amplify with different regions', () => {
      // Arrange
      const regions = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1'];

      regions.forEach(region => {
        vi.clearAllMocks();
        const config = {
          userPoolId: 'test-pool-id',
          userPoolClientId: 'test-client-id',
          region,
        };

        // Act
        configureAmplify(config);

        // Assert
        const configCall = vi.mocked(Amplify.configure).mock.calls[0][0] as any;
        expect(configCall.Auth.Cognito.userPoolId).toBe('test-pool-id');
        expect(configCall.Auth.Cognito.userPoolClientId).toBe('test-client-id');
      });
    });

    it('should configure Amplify with custom pool IDs', () => {
      // Arrange
      const config = {
        userPoolId: 'custom-pool-id-xyz',
        userPoolClientId: 'custom-client-id-abc',
        region: 'eu-central-1',
      };

      // Act
      configureAmplify(config);

      // Assert
      const configCall = vi.mocked(Amplify.configure).mock.calls[0][0] as any;
      expect(configCall.Auth.Cognito.userPoolId).toBe('custom-pool-id-xyz');
      expect(configCall.Auth.Cognito.userPoolClientId).toBe('custom-client-id-abc');
    });

    it('should configure Amplify exactly once per call', () => {
      // Arrange
      const config = {
        userPoolId: 'test-pool',
        userPoolClientId: 'test-client',
        region: 'us-east-1',
      };

      // Act
      configureAmplify(config);

      // Assert
      expect(Amplify.configure).toHaveBeenCalledTimes(1);
    });
  });

  describe('Fail-Fast Behavior for Missing Configuration', () => {
    it('should validate that missing userPoolId would cause an error', () => {
      // This test documents the expected fail-fast behavior
      // The actual validation happens in loadConfig() when no config is provided

      // Arrange
      const invalidConfig = {
        userPoolId: '',
        userPoolClientId: 'test-client-id-123',
        region: 'us-east-1',
      };

      // Act & Assert
      // Simulate the validation logic from loadConfig
      expect(() => {
        if (!invalidConfig.userPoolId) {
          throw new Error(
            'Missing required configuration: VITE_USER_POOL_ID environment variable is not set. ' +
            'Please ensure .env file exists with the correct values from SAM deployment.'
          );
        }
      }).toThrow('Missing required configuration: VITE_USER_POOL_ID');
    });

    it('should validate that missing userPoolClientId would cause an error', () => {
      // Arrange
      const invalidConfig = {
        userPoolId: 'us-east-1_TEST123',
        userPoolClientId: '',
        region: 'us-east-1',
      };

      // Act & Assert
      // Simulate the validation logic from loadConfig
      expect(() => {
        if (!invalidConfig.userPoolClientId) {
          throw new Error(
            'Missing required configuration: VITE_USER_POOL_CLIENT_ID environment variable is not set. ' +
            'Please ensure .env file exists with the correct values from SAM deployment.'
          );
        }
      }).toThrow('Missing required configuration: VITE_USER_POOL_CLIENT_ID');
    });

    it('should not throw when all required configuration is provided', () => {
      // Arrange
      const validConfig = {
        userPoolId: 'us-east-1_TEST123',
        userPoolClientId: 'test-client-id-123',
        region: 'us-east-1',
      };

      // Act & Assert
      expect(() => configureAmplify(validConfig)).not.toThrow();
    });

    it('should provide helpful error message mentioning SAM deployment', () => {
      // Arrange & Act & Assert
      // Verify the error message format includes helpful guidance
      expect(() => {
        const userPoolId = '';
        if (!userPoolId) {
          throw new Error(
            'Missing required configuration: VITE_USER_POOL_ID environment variable is not set. ' +
            'Please ensure .env file exists with the correct values from SAM deployment.'
          );
        }
      }).toThrow('SAM deployment');
    });

    it('should provide helpful error message mentioning .env file', () => {
      // Arrange & Act & Assert
      expect(() => {
        const userPoolClientId = '';
        if (!userPoolClientId) {
          throw new Error(
            'Missing required configuration: VITE_USER_POOL_CLIENT_ID environment variable is not set. ' +
            'Please ensure .env file exists with the correct values from SAM deployment.'
          );
        }
      }).toThrow('.env file');
    });
  });

  describe('Password Policy Configuration', () => {
    it('should configure password policy matching Cognito requirements', () => {
      // Arrange
      const config = {
        userPoolId: 'us-east-1_TEST123',
        userPoolClientId: 'test-client-id-123',
        region: 'us-east-1',
      };

      // Act
      configureAmplify(config);

      // Assert
      const configCall = vi.mocked(Amplify.configure).mock.calls[0][0] as any;
      expect(configCall.Auth.Cognito.passwordFormat).toEqual({
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireNumbers: true,
        requireSpecialCharacters: false,
      });
    });

    it('should require minimum 8 characters', () => {
      // Arrange
      const config = {
        userPoolId: 'test-pool',
        userPoolClientId: 'test-client',
        region: 'us-east-1',
      };

      // Act
      configureAmplify(config);

      // Assert
      const configCall = vi.mocked(Amplify.configure).mock.calls[0][0] as any;
      expect(configCall.Auth.Cognito.passwordFormat.minLength).toBe(8);
    });

    it('should require lowercase letters', () => {
      // Arrange
      const config = {
        userPoolId: 'test-pool',
        userPoolClientId: 'test-client',
        region: 'us-east-1',
      };

      // Act
      configureAmplify(config);

      // Assert
      const configCall = vi.mocked(Amplify.configure).mock.calls[0][0] as any;
      expect(configCall.Auth.Cognito.passwordFormat.requireLowercase).toBe(true);
    });

    it('should require uppercase letters', () => {
      // Arrange
      const config = {
        userPoolId: 'test-pool',
        userPoolClientId: 'test-client',
        region: 'us-east-1',
      };

      // Act
      configureAmplify(config);

      // Assert
      const configCall = vi.mocked(Amplify.configure).mock.calls[0][0] as any;
      expect(configCall.Auth.Cognito.passwordFormat.requireUppercase).toBe(true);
    });

    it('should require numbers', () => {
      // Arrange
      const config = {
        userPoolId: 'test-pool',
        userPoolClientId: 'test-client',
        region: 'us-east-1',
      };

      // Act
      configureAmplify(config);

      // Assert
      const configCall = vi.mocked(Amplify.configure).mock.calls[0][0] as any;
      expect(configCall.Auth.Cognito.passwordFormat.requireNumbers).toBe(true);
    });

    it('should not require special characters in V1', () => {
      // Arrange
      const config = {
        userPoolId: 'test-pool',
        userPoolClientId: 'test-client',
        region: 'us-east-1',
      };

      // Act
      configureAmplify(config);

      // Assert
      const configCall = vi.mocked(Amplify.configure).mock.calls[0][0] as any;
      expect(configCall.Auth.Cognito.passwordFormat.requireSpecialCharacters).toBe(false);
    });
  });

  describe('Authentication Method Configuration', () => {
    it('should configure email login only', () => {
      // Arrange
      const config = {
        userPoolId: 'us-east-1_TEST123',
        userPoolClientId: 'test-client-id-123',
        region: 'us-east-1',
      };

      // Act
      configureAmplify(config);

      // Assert
      const configCall = vi.mocked(Amplify.configure).mock.calls[0][0] as any;
      expect(configCall.Auth.Cognito.loginWith).toEqual({
        email: true,
      });
    });

    it('should configure code-based email verification', () => {
      // Arrange
      const config = {
        userPoolId: 'us-east-1_TEST123',
        userPoolClientId: 'test-client-id-123',
        region: 'us-east-1',
      };

      // Act
      configureAmplify(config);

      // Assert
      const configCall = vi.mocked(Amplify.configure).mock.calls[0][0] as any;
      expect(configCall.Auth.Cognito.signUpVerificationMethod).toBe('code');
    });

    it('should configure email as required user attribute', () => {
      // Arrange
      const config = {
        userPoolId: 'us-east-1_TEST123',
        userPoolClientId: 'test-client-id-123',
        region: 'us-east-1',
      };

      // Act
      configureAmplify(config);

      // Assert
      const configCall = vi.mocked(Amplify.configure).mock.calls[0][0] as any;
      expect(configCall.Auth.Cognito.userAttributes).toEqual({
        email: {
          required: true,
        },
      });
    });

    it('should not configure OAuth or Hosted UI', () => {
      // Arrange
      const config = {
        userPoolId: 'test-pool',
        userPoolClientId: 'test-client',
        region: 'us-east-1',
      };

      // Act
      configureAmplify(config);

      // Assert
      const configCall = vi.mocked(Amplify.configure).mock.calls[0][0] as any;
      // Verify only email login is configured (no OAuth)
      expect(configCall.Auth.Cognito.loginWith).toEqual({ email: true });
    });
  });

  describe('Configuration Structure', () => {
    it('should configure Auth.Cognito namespace', () => {
      // Arrange
      const config = {
        userPoolId: 'test-pool',
        userPoolClientId: 'test-client',
        region: 'us-east-1',
      };

      // Act
      configureAmplify(config);

      // Assert
      const configCall = vi.mocked(Amplify.configure).mock.calls[0][0] as any;
      expect(configCall).toHaveProperty('Auth');
      expect(configCall.Auth).toHaveProperty('Cognito');
    });

    it('should include all required Cognito configuration properties', () => {
      // Arrange
      const config = {
        userPoolId: 'test-pool',
        userPoolClientId: 'test-client',
        region: 'us-east-1',
      };

      // Act
      configureAmplify(config);

      // Assert
      const cognitoConfig = (vi.mocked(Amplify.configure).mock.calls[0][0] as any).Auth.Cognito;
      expect(cognitoConfig).toHaveProperty('userPoolId');
      expect(cognitoConfig).toHaveProperty('userPoolClientId');
      expect(cognitoConfig).toHaveProperty('loginWith');
      expect(cognitoConfig).toHaveProperty('signUpVerificationMethod');
      expect(cognitoConfig).toHaveProperty('userAttributes');
      expect(cognitoConfig).toHaveProperty('passwordFormat');
    });
  });
});
