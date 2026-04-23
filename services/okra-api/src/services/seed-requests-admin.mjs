import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand
} from '@aws-sdk/lib-dynamodb';

let cachedClient = null;
const SEED_REQUEST_COUNTER_KEY = 'stats#seed-requests';

function getDocClient() {
  if (!cachedClient) {
    cachedClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true }
    });
  }
  return cachedClient;
}

function getTableName() {
  const tableName = process.env.SEED_REQUESTS_TABLE_NAME;
  if (!tableName) {
    throw new Error('SEED_REQUESTS_TABLE_NAME is not configured');
  }
  return tableName;
}

function isSeedRequestItem(item) {
  return (
    typeof item?.requestId === 'string' &&
    !item.requestId.startsWith('ratelimit#') &&
    !item.requestId.startsWith('stats#') &&
    typeof item.createdAt === 'string'
  );
}

function mapRequest(item) {
  return {
    requestId: item.requestId,
    name: item.name ?? null,
    email: item.email ?? null,
    fulfillmentMethod: item.fulfillmentMethod ?? null,
    shippingAddress: item.shippingAddress ?? null,
    visitDetails: item.visitDetails ?? null,
    message: item.message ?? null,
    createdAt: item.createdAt,
    status: item.status ?? 'open',
    handledAt: item.handledAt ?? null,
    handledByCognitoSub: item.handledByCognitoSub ?? null,
    reviewNotes: item.reviewNotes ?? null
  };
}

export async function listOpenSeedRequests() {
  const client = getDocClient();
  const tableName = getTableName();
  const results = [];
  let ExclusiveStartKey;

  do {
    const page = await client.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: 'attribute_not_exists(#status) OR #status = :open',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':open': 'open' },
      ExclusiveStartKey
    }));

    for (const item of page.Items ?? []) {
      if (isSeedRequestItem(item)) {
        results.push(mapRequest(item));
      }
    }
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  results.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return results;
}

export async function countOpenSeedRequests() {
  const requests = await listOpenSeedRequests();
  return requests.length;
}

export async function markSeedRequestHandled(requestId, handledBy, reviewNotes) {
  const client = getDocClient();
  const tableName = getTableName();
  const handledAt = new Date().toISOString();

  try {
    const result = await client.send(new UpdateCommand({
      TableName: tableName,
      Key: { requestId },
      UpdateExpression:
        'SET #status = :handled, handledAt = :handledAt, handledByCognitoSub = :handledBy, reviewNotes = :reviewNotes',
      ConditionExpression:
        'attribute_exists(requestId) AND (attribute_not_exists(#status) OR #status = :open)',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':handled': 'handled',
        ':open': 'open',
        ':handledAt': handledAt,
        ':handledBy': handledBy ?? 'system',
        ':reviewNotes': reviewNotes ?? null
      },
      ReturnValues: 'ALL_NEW'
    }));

    return mapRequest(result.Attributes);
  } catch (error) {
    if (error?.name === 'ConditionalCheckFailedException') {
      return null;
    }
    throw error;
  }
}

export { SEED_REQUEST_COUNTER_KEY };
