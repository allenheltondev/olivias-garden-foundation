import {
  CognitoIdentityProviderClient,
  DescribeUserPoolCommand
} from '@aws-sdk/client-cognito-identity-provider';
import { createDbClient } from '../../scripts/db-client.mjs';
import { countOpenSeedRequests } from './seed-requests-admin.mjs';

let cognitoClient;

function getCognitoClient() {
  if (!cognitoClient) {
    cognitoClient = new CognitoIdentityProviderClient({});
  }
  return cognitoClient;
}

export async function getUserCount() {
  const userPoolId = process.env.SHARED_USER_POOL_ID;
  if (!userPoolId) {
    return null;
  }

  try {
    const result = await getCognitoClient().send(new DescribeUserPoolCommand({
      UserPoolId: userPoolId
    }));
    return result.UserPool?.EstimatedNumberOfUsers ?? null;
  } catch (error) {
    console.warn(JSON.stringify({
      level: 'warn',
      message: 'Failed to read user pool user count',
      error: error instanceof Error ? error.message : String(error)
    }));
    return null;
  }
}

export async function countPendingOkraSubmissions() {
  const client = await createDbClient();
  await client.connect();
  try {
    const result = await client.query(
      `SELECT COUNT(*)::int AS count
         FROM submissions
        WHERE status = 'pending_review'`
    );
    return result.rows[0]?.count ?? 0;
  } finally {
    await client.end();
  }
}

export async function getAdminStats() {
  const [userCount, openSeedRequestCount, pendingOkraCount] = await Promise.all([
    getUserCount(),
    countOpenSeedRequests(),
    countPendingOkraSubmissions().catch((error) => {
      console.warn(JSON.stringify({
        level: 'warn',
        message: 'Failed to count pending okra submissions',
        error: error instanceof Error ? error.message : String(error)
      }));
      return null;
    })
  ]);

  return { userCount, openSeedRequestCount, pendingOkraCount };
}
