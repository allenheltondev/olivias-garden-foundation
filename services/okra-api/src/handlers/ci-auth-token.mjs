import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminAddUserToGroupCommand,
  InitiateAuthCommand
} from '@aws-sdk/client-cognito-identity-provider';
import { createDbClient } from '../../scripts/db-client.mjs';

const client = new CognitoIdentityProviderClient();

/**
 * Lambda that upserts a CI admin user and returns an access token.
 * Credentials come from environment variables, passed through from GitHub secrets at deploy time.
 * Intended for CI use only — should NOT be deployed to production.
 */
export const handler = async () => {
  const userPoolId = process.env.SHARED_USER_POOL_ID;
  const clientId = process.env.SHARED_USER_POOL_CLIENT_ID;
  const username = process.env.CI_ADMIN_USERNAME;
  const password = process.env.CI_ADMIN_PASSWORD;
  const adminGroup = process.env.ADMIN_REQUIRED_GROUP ?? 'admin';

  if (!userPoolId || !clientId || !username || !password) {
    throw new Error('Required env vars: SHARED_USER_POOL_ID, SHARED_USER_POOL_CLIENT_ID, CI_ADMIN_USERNAME, CI_ADMIN_PASSWORD');
  }

  // 1. Create user (idempotent)
  try {
    await client.send(new AdminCreateUserCommand({
      UserPoolId: userPoolId,
      Username: username,
      MessageAction: 'SUPPRESS',
      TemporaryPassword: password
    }));
  } catch (err) {
    if (err.name !== 'UsernameExistsException') throw err;
  }

  // 2. Set permanent password
  await client.send(new AdminSetUserPasswordCommand({
    UserPoolId: userPoolId,
    Username: username,
    Password: password,
    Permanent: true
  }));

  // 3. Ensure admin group membership
  await client.send(new AdminAddUserToGroupCommand({
    UserPoolId: userPoolId,
    Username: username,
    GroupName: adminGroup
  }));

  // 4. Authenticate and return token
  const auth = await client.send(new InitiateAuthCommand({
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: clientId,
    AuthParameters: {
      USERNAME: username,
      PASSWORD: password
    }
  }));

  const accessToken = auth.AuthenticationResult?.AccessToken;
  if (!accessToken) {
    throw new Error(`Auth succeeded but no AccessToken — challenge: ${auth.ChallengeName ?? 'none'}`);
  }

  // 5. Upsert admin user in the database so route handlers can resolve the cognito sub
  const tokenPayload = JSON.parse(
    Buffer.from(accessToken.split('.')[1], 'base64url').toString()
  );
  const cognitoSub = tokenPayload.sub;

  const db = await createDbClient();
  await db.connect();
  try {
    await db.query(
      `INSERT INTO admin_users (cognito_sub, email, display_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (cognito_sub) DO UPDATE SET updated_at = now()`,
      [cognitoSub, username, `CI Admin (${username})`]
    );
  } finally {
    await db.end();
  }

  return { accessToken };
};
