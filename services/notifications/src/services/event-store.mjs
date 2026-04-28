import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

let cachedClient = null;

function getDocClient() {
  if (!cachedClient) {
    cachedClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true }
    });
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

function ttlSeconds(occurredAtIso) {
  const days = Number(process.env.ACTIVITY_TTL_DAYS ?? 30);
  const occurred = Date.parse(occurredAtIso);
  const base = Number.isFinite(occurred) ? occurred : Date.now();
  return Math.floor(base / 1000) + Math.floor(days * 24 * 60 * 60);
}

export async function putActivityEvent({ eventId, source, detailType, occurredAt, summary, data }) {
  if (!eventId) throw new Error('eventId is required');
  if (!source) throw new Error('source is required');
  if (!detailType) throw new Error('detailType is required');
  if (!occurredAt) throw new Error('occurredAt is required');

  const item = {
    pk: 'ACTIVITY',
    sk: `${occurredAt}#${eventId}`,
    eventId,
    source,
    detailType,
    occurredAt,
    summary: summary ?? null,
    data: data ?? {},
    expiresAt: ttlSeconds(occurredAt)
  };

  await getDocClient().send(new PutCommand({
    TableName: getTableName(),
    Item: item,
    ConditionExpression: 'attribute_not_exists(pk)'
  }));
}
