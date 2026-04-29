import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resolveOptionalAuthContextMock = vi.fn();
const extractBearerTokenMock = vi.fn();
const createDbClientMock = vi.fn();
const cognitoSendMock = vi.fn();

vi.mock('../src/services/auth.mjs', () => ({
  resolveOptionalAuthContext: resolveOptionalAuthContextMock,
  extractBearerToken: extractBearerTokenMock
}));

vi.mock('@aws-sdk/client-cognito-identity-provider', () => {
  class CognitoIdentityProviderClient {
    send(command) { return cognitoSendMock(command); }
  }
  class DeleteUserCommand {
    constructor(input) { this.commandName = 'DeleteUserCommand'; this.input = input; }
  }
  class AdminDeleteUserCommand {
    constructor(input) { this.commandName = 'AdminDeleteUserCommand'; this.input = input; }
  }
  return {
    CognitoIdentityProviderClient,
    DeleteUserCommand,
    AdminDeleteUserCommand
  };
});

vi.mock('../scripts/db-client.mjs', () => ({
  createDbClient: createDbClientMock
}));

const { handler } = await import('../src/handlers/api.mjs');

const USER_ID = '00000000-0000-0000-0000-000000000001';

function createApiGatewayEvent({ method, path, body, headers = {}, queryStringParameters }) {
  return {
    version: '2.0',
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: new URLSearchParams(queryStringParameters ?? {}).toString(),
    headers: { ...headers },
    queryStringParameters,
    requestContext: {
      accountId: '123456789012',
      apiId: 'api-id',
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'vitest' },
      requestId: 'request-id',
      routeKey: `${method} ${path}`,
      stage: '$default',
      time: '20/Apr/2026:11:00:00 +0000',
      timeEpoch: 1776682800000
    },
    isBase64Encoded: false,
    body: body === undefined ? undefined : JSON.stringify(body)
  };
}

function createClientMock(queryImpl) {
  const connect = vi.fn().mockResolvedValue(undefined);
  const end = vi.fn().mockResolvedValue(undefined);
  const query = vi.fn(queryImpl);
  return { connect, end, query };
}

function baseProfileRow(overrides = {}) {
  return {
    id: USER_ID,
    email: 'olivia@example.com',
    display_name: 'Olivia',
    tier: 'free',
    first_name: 'Olivia',
    last_name: 'Garden',
    bio: 'I grow okra.',
    city: 'McKinney',
    region: 'TX',
    country: 'US',
    timezone: 'America/Chicago',
    website_url: 'https://olivia.example',
    avatar_s3_key: null,
    avatar_thumbnail_s3_key: null,
    avatar_status: 'none',
    avatar_processing_error: null,
    garden_club_status: 'active',
    donation_total_cents: 5000,
    donation_count: 2,
    last_donated_at: '2026-03-15T00:00:00.000Z',
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2026-03-15T00:00:00.000Z',
    profile_updated_at: '2026-03-15T00:00:00.000Z',
    ...overrides
  };
}

describe('web-api profile handler', () => {
  beforeEach(() => {
    resolveOptionalAuthContextMock.mockReset();
    extractBearerTokenMock.mockReset();
    createDbClientMock.mockReset();
    cognitoSendMock.mockReset();
    cognitoSendMock.mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /profile', () => {
    it('returns 500 with "Authorization token is required" when unauthenticated', async () => {
      resolveOptionalAuthContextMock.mockResolvedValue(null);

      const response = await handler(createApiGatewayEvent({ method: 'GET', path: '/profile' }));

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: 'Authorization token is required'
      });
      expect(createDbClientMock).not.toHaveBeenCalled();
    });

    it('ensures a users row exists and returns the mapped profile', async () => {
      resolveOptionalAuthContextMock.mockResolvedValue({
        userId: USER_ID,
        email: 'olivia@example.com',
        name: 'Olivia Garden',
        firstName: 'Olivia',
        lastName: 'Garden'
      });

      const row = baseProfileRow();
      const client = createClientMock((sql) => {
        if (sql.trim().startsWith('insert into users')) {
          return Promise.resolve({ rowCount: 1 });
        }
        return Promise.resolve({ rows: [row], rowCount: 1 });
      });
      createDbClientMock.mockResolvedValue(client);

      const response = await handler(createApiGatewayEvent({ method: 'GET', path: '/profile' }));

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.userId).toBe(USER_ID);
      expect(body.firstName).toBe('Olivia');
      expect(body.displayName).toBe('Olivia');
      expect(body.city).toBe('McKinney');
      expect(body.donationTotalCents).toBe(5000);
      expect(body.donationCount).toBe(2);
      expect(body.gardenClubStatus).toBe('active');

      expect(client.query).toHaveBeenCalledTimes(2);
      expect(client.query.mock.calls[0][0]).toContain('insert into users');
      expect(client.query.mock.calls[0][1]).toEqual([
        USER_ID,
        'olivia@example.com',
        'Olivia',
        'Garden',
        'Olivia Garden'
      ]);
      expect(client.end).toHaveBeenCalledOnce();
    });

    it('returns default empty profile when the users row has no record', async () => {
      resolveOptionalAuthContextMock.mockResolvedValue({
        userId: USER_ID,
        email: 'new@example.com',
        name: 'New User'
      });

      const client = createClientMock(() => Promise.resolve({ rows: [], rowCount: 0 }));
      createDbClientMock.mockResolvedValue(client);

      const response = await handler(createApiGatewayEvent({ method: 'GET', path: '/profile' }));

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.userId).toBe(USER_ID);
      expect(body.email).toBe('new@example.com');
      expect(body.displayName).toBe('New User');
      expect(body.donationTotalCents).toBe(0);
      expect(body.donationCount).toBe(0);
      expect(body.gardenClubStatus).toBe('none');
    });
  });

  describe('PUT /profile', () => {
    it('rejects extra properties with a 422 validation error', async () => {
      resolveOptionalAuthContextMock.mockResolvedValue({ userId: USER_ID });

      const response = await handler(createApiGatewayEvent({
        method: 'PUT',
        path: '/profile',
        body: { firstName: 'Olivia', sneaky: 'field' }
      }));

      expect(response.statusCode).toBe(422);
      expect(JSON.parse(response.body).error).toBe('RequestValidationError');
      expect(createDbClientMock).not.toHaveBeenCalled();
    });

    it('rejects an invalid website URL with 500 mapped error', async () => {
      resolveOptionalAuthContextMock.mockResolvedValue({
        userId: USER_ID,
        email: 'olivia@example.com',
        name: 'Olivia'
      });

      const client = createClientMock((sql) => {
        if (sql.trim().startsWith('insert into users')) {
          return Promise.resolve({ rowCount: 1 });
        }
        return Promise.resolve({ rows: [baseProfileRow()], rowCount: 1 });
      });
      createDbClientMock.mockResolvedValue(client);

      const response = await handler(createApiGatewayEvent({
        method: 'PUT',
        path: '/profile',
        body: { websiteUrl: 'not-a-url' }
      }));

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body).error).toContain('websiteUrl must be a valid absolute URL');
    });

    it('persists trimmed profile fields and returns the updated profile', async () => {
      resolveOptionalAuthContextMock.mockResolvedValue({
        userId: USER_ID,
        email: 'olivia@example.com',
        name: 'Olivia'
      });

      const updatedRow = baseProfileRow({
        first_name: 'Liv',
        last_name: 'Garden',
        bio: 'New bio',
        city: 'Austin',
        region: 'TX',
        country: 'US',
        timezone: 'America/Chicago',
        website_url: 'https://olivia.example'
      });

      const client = createClientMock((sql) => {
        if (sql.trim().startsWith('insert into users')) {
          return Promise.resolve({ rowCount: 1 });
        }
        return Promise.resolve({ rows: [updatedRow], rowCount: 1 });
      });
      createDbClientMock.mockResolvedValue(client);

      const response = await handler(createApiGatewayEvent({
        method: 'PUT',
        path: '/profile',
        body: {
          firstName: '  Liv  ',
          lastName: 'Garden',
          bio: 'New bio',
          city: 'Austin',
          region: 'TX',
          country: 'US',
          timezone: 'America/Chicago',
          websiteUrl: 'https://olivia.example'
        }
      }));

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.firstName).toBe('Liv');
      expect(body.city).toBe('Austin');
      expect(body.websiteUrl).toBe('https://olivia.example');

      const updateCall = client.query.mock.calls.find(([sql]) => sql.includes('update users'));
      expect(updateCall).toBeDefined();
      const [, params] = updateCall;
      expect(params[0]).toBe(USER_ID);
      expect(params[1]).toBe('Liv');
      expect(params[5]).toBe('Austin');
      expect(params[9]).toBe('https://olivia.example/');
    });

    it('normalizes empty-string fields to null so they clear out existing values', async () => {
      resolveOptionalAuthContextMock.mockResolvedValue({
        userId: USER_ID,
        email: 'olivia@example.com',
        name: 'Olivia'
      });

      const client = createClientMock((sql) => {
        if (sql.trim().startsWith('insert into users')) {
          return Promise.resolve({ rowCount: 1 });
        }
        return Promise.resolve({ rows: [baseProfileRow({ bio: null, city: null })], rowCount: 1 });
      });
      createDbClientMock.mockResolvedValue(client);

      const response = await handler(createApiGatewayEvent({
        method: 'PUT',
        path: '/profile',
        body: { bio: '   ', city: '' }
      }));

      expect(response.statusCode).toBe(200);
      const updateCall = client.query.mock.calls.find(([sql]) => sql.includes('update users'));
      const [, params] = updateCall;
      // bio is index 4, city is index 5.
      expect(params[4]).toBeNull();
      expect(params[5]).toBeNull();
    });
  });

  describe('GET /profile/activity', () => {
    it('returns 500 with auth error when unauthenticated', async () => {
      resolveOptionalAuthContextMock.mockResolvedValue(null);

      const response = await handler(createApiGatewayEvent({ method: 'GET', path: '/profile/activity' }));

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        error: 'Authorization token is required'
      });
    });

    it('returns the signed-in user\'s donation history sorted by created_at desc', async () => {
      resolveOptionalAuthContextMock.mockResolvedValue({ userId: USER_ID });

      const rows = [
        {
          id: 'donation-2',
          donation_mode: 'recurring',
          amount_cents: 2500,
          currency: 'usd',
          dedication_name: 'Grandma',
          t_shirt_preference: 'L',
          created_at: '2026-03-01T00:00:00.000Z'
        },
        {
          id: 'donation-1',
          donation_mode: 'one_time',
          amount_cents: 5000,
          currency: 'usd',
          dedication_name: null,
          t_shirt_preference: null,
          created_at: '2026-01-15T00:00:00.000Z'
        }
      ];

      const client = createClientMock(() => Promise.resolve({ rows, rowCount: rows.length }));
      createDbClientMock.mockResolvedValue(client);

      const response = await handler(createApiGatewayEvent({ method: 'GET', path: '/profile/activity' }));

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.donations).toHaveLength(2);
      expect(body.donations[0]).toEqual({
        id: 'donation-2',
        type: 'donation',
        donationMode: 'recurring',
        amountCents: 2500,
        currency: 'usd',
        dedicationName: 'Grandma',
        tShirtPreference: 'L',
        createdAt: '2026-03-01T00:00:00.000Z'
      });
      expect(client.query).toHaveBeenCalledOnce();
      expect(client.query.mock.calls[0][1]).toEqual([USER_ID]);
    });

    it('returns an empty donations list when the user has no history', async () => {
      resolveOptionalAuthContextMock.mockResolvedValue({ userId: USER_ID });

      const client = createClientMock(() => Promise.resolve({ rows: [], rowCount: 0 }));
      createDbClientMock.mockResolvedValue(client);

      const response = await handler(createApiGatewayEvent({ method: 'GET', path: '/profile/activity' }));

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ donations: [] });
    });
  });

  describe('avatar URL composition', () => {
    it('builds avatarUrl and avatarThumbnailUrl from MEDIA_CDN_DOMAIN and the stored S3 keys', async () => {
      process.env.MEDIA_CDN_DOMAIN = 'cdn.example.com';
      resolveOptionalAuthContextMock.mockResolvedValue({
        userId: USER_ID,
        email: 'olivia@example.com',
        name: 'Olivia'
      });

      const row = baseProfileRow({
        avatar_s3_key: `avatars/${USER_ID}/abc/display.webp`,
        avatar_thumbnail_s3_key: `avatars/${USER_ID}/abc/thumbnail.webp`,
        avatar_status: 'ready'
      });

      const client = createClientMock((sql) => {
        if (sql.trim().startsWith('insert into users')) {
          return Promise.resolve({ rowCount: 1 });
        }
        return Promise.resolve({ rows: [row], rowCount: 1 });
      });
      createDbClientMock.mockResolvedValue(client);

      const response = await handler(createApiGatewayEvent({ method: 'GET', path: '/profile' }));

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.avatarUrl).toBe(`https://cdn.example.com/avatars/${USER_ID}/abc/display.webp`);
      expect(body.avatarThumbnailUrl).toBe(`https://cdn.example.com/avatars/${USER_ID}/abc/thumbnail.webp`);
      expect(body.avatarStatus).toBe('ready');

      delete process.env.MEDIA_CDN_DOMAIN;
    });
  });

  describe('DELETE /profile', () => {
    it('returns 400 with auth error when unauthenticated', async () => {
      resolveOptionalAuthContextMock.mockResolvedValue(null);

      const response = await handler(createApiGatewayEvent({
        method: 'DELETE',
        path: '/profile'
      }));

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toBe('Authorization token is required');
      expect(createDbClientMock).not.toHaveBeenCalled();
      expect(cognitoSendMock).not.toHaveBeenCalled();
    });

    it('redacts profile PII, scrubs donor fields, and self-deletes the Cognito user', async () => {
      process.env.OGF_USER_POOL_ID = 'us-east-1_abc123';
      resolveOptionalAuthContextMock.mockResolvedValue({
        userId: USER_ID,
        email: 'olivia@example.com',
        name: 'Olivia'
      });
      extractBearerTokenMock.mockReturnValue('access-token-value');

      const client = createClientMock(() => Promise.resolve({ rowCount: 1 }));
      createDbClientMock.mockResolvedValue(client);

      const response = await handler(createApiGatewayEvent({
        method: 'DELETE',
        path: '/profile',
        headers: { authorization: 'Bearer access-token-value' }
      }));

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ status: 'deleted' });

      const sqlCalls = client.query.mock.calls.map(([sql]) => sql.trim());
      expect(sqlCalls.some((sql) => sql.startsWith('begin'))).toBe(true);
      expect(sqlCalls.some((sql) => sql.includes('update users') && sql.includes('deleted_at = coalesce'))).toBe(true);
      expect(sqlCalls.some((sql) => sql.includes('update donation_events'))).toBe(true);
      expect(sqlCalls.some((sql) => sql.startsWith('commit'))).toBe(true);

      expect(cognitoSendMock).toHaveBeenCalledOnce();
      const command = cognitoSendMock.mock.calls[0][0];
      expect(command.commandName).toBe('DeleteUserCommand');
      expect(command.input).toEqual({ AccessToken: 'access-token-value' });

      delete process.env.OGF_USER_POOL_ID;
    });

    it('falls back to AdminDeleteUser when the caller presented an id token', async () => {
      process.env.OGF_USER_POOL_ID = 'us-east-1_abc123';
      resolveOptionalAuthContextMock.mockResolvedValue({ userId: USER_ID });
      extractBearerTokenMock.mockReturnValue('id-token-value');

      const client = createClientMock(() => Promise.resolve({ rowCount: 1 }));
      createDbClientMock.mockResolvedValue(client);

      const notAuthorized = new Error('Access token is not valid');
      notAuthorized.name = 'NotAuthorizedException';
      cognitoSendMock.mockRejectedValueOnce(notAuthorized);
      cognitoSendMock.mockResolvedValueOnce({});

      const response = await handler(createApiGatewayEvent({
        method: 'DELETE',
        path: '/profile'
      }));

      expect(response.statusCode).toBe(200);
      expect(cognitoSendMock).toHaveBeenCalledTimes(2);
      expect(cognitoSendMock.mock.calls[1][0].commandName).toBe('AdminDeleteUserCommand');
      expect(cognitoSendMock.mock.calls[1][0].input).toEqual({
        UserPoolId: 'us-east-1_abc123',
        Username: USER_ID
      });

      delete process.env.OGF_USER_POOL_ID;
    });
  });

  describe('POST /profile/avatar/complete', () => {
    it('returns 400 when unauthenticated', async () => {
      resolveOptionalAuthContextMock.mockResolvedValue(null);

      const response = await handler(createApiGatewayEvent({
        method: 'POST',
        path: '/profile/avatar/complete'
      }));

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toBe('Authorization token is required');
    });

    it('returns 404 when there is no uploaded avatar to finalize', async () => {
      resolveOptionalAuthContextMock.mockResolvedValue({ userId: USER_ID });

      const client = createClientMock(() => Promise.resolve({ rows: [], rowCount: 0 }));
      createDbClientMock.mockResolvedValue(client);

      const response = await handler(createApiGatewayEvent({
        method: 'POST',
        path: '/profile/avatar/complete'
      }));

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).error).toBe('No uploaded avatar found to process');
    });
  });
});
