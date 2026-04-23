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
    countOpenSeedRequests().catch((error) => {
      console.warn(JSON.stringify({
        level: 'warn',
        message: 'Failed to count open seed requests',
        error: error instanceof Error ? error.message : String(error)
      }));
      return 0;
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
