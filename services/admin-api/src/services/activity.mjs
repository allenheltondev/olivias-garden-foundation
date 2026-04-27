import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

let cachedClient = null;

function getDocClient() {
  if (!cachedClient) {
    cachedClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }
  return cachedClient;
}

function getTableName() {
  const tableName = process.env.ACTIVITY_EVENTS_TABLE_NAME;
  if (!tableName) {
    throw new Error('ACTIVITY_EVENTS_TABLE_NAME is not configured');
  }
  return tableName;
}

export function decodeCursor(cursor) {
  if (!cursor) return undefined;
  try {
    return JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
}

export function encodeCursor(key) {
  if (!key) return null;
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
}

export function clampLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 25;
  return Math.min(Math.max(Math.floor(parsed), 1), 100);
}

export function toActivityItem(raw) {
  return {
    eventId: raw.eventId,
    source: raw.source,
    detailType: raw.detailType,
    occurredAt: raw.occurredAt,
    summary: raw.summary ?? null,
    data: raw.data ?? {}
  };
}

export function buildActivityQueryParams({ cursor, limit, detailType, tableName }) {
  const queryParams = {
    TableName: tableName,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: { ':pk': 'ACTIVITY' },
    ScanIndexForward: false,
    Limit: clampLimit(limit),
    ExclusiveStartKey: decodeCursor(cursor)
  };

  if (typeof detailType === 'string' && detailType.trim()) {
    queryParams.FilterExpression = '#dt = :dt';
    queryParams.ExpressionAttributeNames = { '#dt': 'detailType' };
    queryParams.ExpressionAttributeValues[':dt'] = detailType.trim();
  }

  return queryParams;
}

export async function listActivity({ cursor, limit, detailType } = {}) {
  const queryParams = buildActivityQueryParams({
    cursor,
    limit,
    detailType,
    tableName: getTableName()
  });

  const result = await getDocClient().send(new QueryCommand(queryParams));
  return {
    items: (result.Items ?? []).map(toActivityItem),
    nextCursor: encodeCursor(result.LastEvaluatedKey)
  };
}
