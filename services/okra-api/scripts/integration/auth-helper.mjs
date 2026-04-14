import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminAddUserToGroupCommand,
  InitiateAuthCommand
} from '@aws-sdk/client-cognito-identity-provider';

const TRANSIENT_ERROR_CODES = new Set([
  'ThrottlingException',
  'TooManyRequestsException',
  'ServiceUnavailableException'
]);

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

/**
 * Retries an async operation on transient AWS errors with exponential backoff.
 * Non-transient errors are thrown immediately.
 *
 * @param {() => Promise<T>} fn
 * @param {string} label - description for error messages
 * @returns {Promise<T>}
 * @template T
 */
async function withRetry(fn, label) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const code = err.name ?? err.Code ?? err.__type;
      if (!TRANSIENT_ERROR_CODES.has(code) || attempt === MAX_RETRIES) {
        throw new Error(
          `${label} failed after ${attempt + 1} attempt(s): [${code}] ${err.message}`
        );
      }
      const delay = BASE_DELAY_MS * 2 ** attempt;
      console.log(`  ⟳ ${label}: transient error (${code}), retrying in ${delay}ms…`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

/**
 * Upserts a durable CI admin user in Cognito and returns an access token.
 *
 * @param {object} config
 * @param {string} config.userPoolId    - SHARED_USER_POOL_ID
 * @param {string} config.clientId      - SHARED_USER_POOL_CLIENT_ID
 * @param {string} config.username      - TEST_ADMIN_USERNAME
 * @param {string} config.password      - TEST_ADMIN_PASSWORD
 * @param {string} [config.adminGroup]  - Group name (default: "admin")
 * @returns {Promise<string>} accessToken
 * @throws {Error} with descriptive message if any step fails
 */
export async function upsertAdminAndGetToken(config) {
  const {
    userPoolId,
    clientId,
    username,
    password,
    adminGroup = 'admin'
  } = config;

  if (!userPoolId || !clientId || !username || !password) {
    throw new Error(
      'Auth config incomplete — required: userPoolId, clientId, username, password'
    );
  }

  const client = new CognitoIdentityProviderClient();

  // Step 1: Create user (idempotent — catch UsernameExistsException)
  await withRetry(async () => {
    try {
      await client.send(
        new AdminCreateUserCommand({
          UserPoolId: userPoolId,
          Username: username,
          MessageAction: 'SUPPRESS',
          TemporaryPassword: password
        })
      );
      console.log(`  ✓ Created Cognito user: ${username}`);
    } catch (err) {
      if (err.name === 'UsernameExistsException') {
        console.log(`  ✓ Cognito user already exists: ${username}`);
        return;
      }
      throw err;
    }
  }, 'AdminCreateUser');

  // Step 2: Set permanent password (handles FORCE_CHANGE_PASSWORD state)
  await withRetry(async () => {
    await client.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: userPoolId,
        Username: username,
        Password: password,
        Permanent: true
      })
    );
    console.log(`  ✓ Set permanent password for: ${username}`);
  }, 'AdminSetUserPassword');

  // Step 3: Ensure admin group membership (idempotent)
  await withRetry(async () => {
    await client.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: userPoolId,
        Username: username,
        GroupName: adminGroup
      })
    );
    console.log(`  ✓ Ensured group membership: ${adminGroup}`);
  }, 'AdminAddUserToGroup');

  // Step 4: Authenticate and get access token
  const authResult = await withRetry(async () => {
    const res = await client.send(
      new InitiateAuthCommand({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: clientId,
        AuthParameters: {
          USERNAME: username,
          PASSWORD: password
        }
      })
    );
    return res;
  }, 'InitiateAuth');

  const accessToken = authResult.AuthenticationResult?.AccessToken;
  if (!accessToken) {
    throw new Error(
      'InitiateAuth succeeded but no AccessToken in response — ' +
        `challenge: ${authResult.ChallengeName ?? 'none'}`
    );
  }

  console.log(`  ✓ Obtained access token for: ${username}`);
  return accessToken;
}
