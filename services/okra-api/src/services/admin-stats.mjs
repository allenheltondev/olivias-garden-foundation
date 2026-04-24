import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import {
  CognitoIdentityProviderClient,
  DescribeUserPoolCommand
} from '@aws-sdk/client-cognito-identity-provider';
import { createDbClient } from '../../scripts/db-client.mjs';

let dynamoClient;
let cognitoClient;

function getDynamoClient() {
  if (!dynamoClient) {
    dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true }
    });
  }
  return dynamoClient;
}

function getCognitoClient() {
  if (!cognitoClient) {
    cognitoClient = new CognitoIdentityProviderClient({});
  }
  return cognitoClient;
}

function getSeedRequestsTableName() {
  const tableName = process.env.SEED_REQUESTS_TABLE_NAME;
  if (!tableName) {
    throw new Error('SEED_REQUESTS_TABLE_NAME is not configured');
  }
  return tableName;
}

function isSeedRequestItem(item) {
  const requestId = String(item?.requestId ?? '');
  return (
    requestId.length > 0 &&
    !requestId.startsWith('ratelimit#') &&
    !requestId.startsWith('stats#') &&
    typeof item?.createdAt === 'string'
  );
}

export async function countOpenSeedRequests() {
  const client = getDynamoClient();
  const tableName = getSeedRequestsTableName();
  let total = 0;
  let ExclusiveStartKey;

  do {
    const page = await client.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: 'attribute_exists(createdAt) AND (attribute_not_exists(#status) OR #status = :open)',
      ExpressionAttributeNames: { '#status': 'requestStatus' },
      ExpressionAttributeValues: { ':open': 'open' },
      ExclusiveStartKey
    }));

    for (const item of page.Items ?? []) {
      if (isSeedRequestItem(item)) {
        total += 1;
      }
    }
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return total;
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

// Mirrors the GET /submissions?status=pending moderation-queue filter:
// a submission only counts as actionable when it has at least one
// submission_photos row in `ready` status. Without this, the dashboard
// inflates the backlog whenever photo processing lags or fails.
export async function countPendingOkraSubmissions() {
  const client = await createDbClient();
  await client.connect();
  try {
    const result = await client.query(
      `SELECT COUNT(*)::int AS count
         FROM submissions s
        WHERE s.status = 'pending_review'
          AND EXISTS (
            SELECT 1 FROM submission_photos sp
             WHERE sp.submission_id = s.id
               AND sp.status = 'ready'
          )`
    );
    return result.rows[0]?.count ?? 0;
  } finally {
    await client.end();
  }
}

export async function getAdminStats() {
  const [userCount, openSeedRequestCount, pendingOkraCount] = await Promise.all([
    getUserCount(),
    // Return null (not 0) on failure so the UI can show an unknown/errored
    // state. Reporting 0 here is indistinguishable from a real empty queue
    // and can hide requests that still need fulfillment.
    countOpenSeedRequests().catch((error) => {
      console.warn(JSON.stringify({
        level: 'warn',
        message: 'Failed to count open seed requests',
        error: error instanceof Error ? error.message : String(error)
      }));
      return null;
    }),
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
