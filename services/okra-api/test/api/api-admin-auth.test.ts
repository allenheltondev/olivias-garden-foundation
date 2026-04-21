import { vi, describe, it, expect, beforeEach } from 'vitest';

// ─── Authorizer tests ───────────────────────────────────────────────────────

const mockVerify = vi.fn();

vi.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: {
    create: () => ({ verify: mockVerify })
  }
}));

import { handler as authorizerHandler } from '../../src/handlers/admin-authorizer.mjs';

function makeAuthorizerEvent(token) {
  return {
    type: 'TOKEN',
    authorizationToken: token ? `Bearer ${token}` : undefined,
    methodArn: 'arn:aws:execute-api:us-east-1:123456789:abc/admin/GET/health'
  };
}

beforeEach(() => {
  mockVerify.mockReset();
  process.env.SHARED_USER_POOL_ID = 'us-east-1_test';
  process.env.SHARED_USER_POOL_CLIENT_ID = 'test-client-id';
  process.env.ADMIN_REQUIRED_GROUP = 'admin';
});

describe('admin authorizer', () => {
  it('throws Unauthorized when no token is provided', async () => {
    await expect(authorizerHandler(makeAuthorizerEvent(null))).rejects.toThrow('Unauthorized');
  });

  it('throws Unauthorized when token verification fails', async () => {
    mockVerify.mockRejectedValue(new Error('invalid token'));
    await expect(authorizerHandler(makeAuthorizerEvent('bad-token'))).rejects.toThrow('Unauthorized');
  });

  it('throws Unauthorized when user lacks admin group', async () => {
    mockVerify.mockResolvedValue({
      sub: 'user-123',
      'cognito:groups': ['viewer']
    });
    await expect(authorizerHandler(makeAuthorizerEvent('valid-token'))).rejects.toThrow('Unauthorized');
  });

  it('returns Allow policy with user context for valid admin', async () => {
    mockVerify.mockResolvedValue({
      sub: 'admin-123',
      email: 'admin@example.com',
      'cognito:groups': ['admin', 'editor']
    });

    const result = await authorizerHandler(makeAuthorizerEvent('valid-token'));

    expect(result.principalId).toBe('admin-123');
    expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
    expect(result.context.sub).toBe('admin-123');
    expect(result.context.email).toBe('admin@example.com');
    expect(result.context.groups).toBe(JSON.stringify(['admin', 'editor']));
  });
});

// ─── Admin API handler reads authorizer context ─────────────────────────────

import { handler as adminApiHandler } from '../../src/handlers/admin-api.mjs';

vi.mock('../../scripts/db-client.mjs', () => ({
  createDbClient: vi.fn(() => ({
    connect: vi.fn(),
    query: vi.fn(() => ({ rows: [], rowCount: 0 })),
    end: vi.fn()
  }))
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(() => Promise.resolve('https://s3.example.com/signed'))
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({})),
  GetObjectCommand: vi.fn((p) => p)
}));

vi.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: vi.fn(() => ({ send: vi.fn(() => Promise.resolve({})) })),
  PutEventsCommand: vi.fn((p) => p)
}));

function makeAdminApiEvent(path, method = 'GET', authorizer = {}) {
  return {
    resource: '/{proxy+}',
    path,
    httpMethod: method,
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    requestContext: {
      requestId: 'req-admin',
      path,
      stage: 'admin',
      identity: { sourceIp: '127.0.0.1', userAgent: 'vitest' },
      authorizer
    },
    body: null,
    isBase64Encoded: false
  };
}

describe('admin api returns 404 for unknown routes', () => {
  it('returns 404 for unregistered path', async () => {
    const res = await adminApiHandler(
      makeAdminApiEvent('/does-not-exist', 'GET', { sub: 'admin-456' })
    );
    expect(res.statusCode).toBe(404);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['x-correlation-id']).toBe('req-admin');
  });
});
