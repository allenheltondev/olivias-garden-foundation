import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

export const SUPPORTED_COUNTRIES = ['US', 'CA'];

export const seedRequestSchema = {
  type: 'object',
  required: ['name', 'email', 'fulfillmentMethod'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    email: { type: 'string', minLength: 3, maxLength: 320, pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' },
    fulfillmentMethod: { type: 'string', enum: ['mail', 'in_person'] },
    shippingAddress: {
      type: 'object',
      properties: {
        line1: { type: 'string', maxLength: 200 },
        line2: { type: 'string', maxLength: 200 },
        city: { type: 'string', maxLength: 120 },
        region: { type: 'string', maxLength: 120 },
        postalCode: { type: 'string', maxLength: 20 },
        country: { type: 'string', enum: SUPPORTED_COUNTRIES }
      },
      additionalProperties: false
    },
    visitDetails: {
      type: 'object',
      properties: {
        approximateDate: { type: 'string', maxLength: 120 },
        notes: { type: 'string', maxLength: 1000 }
      },
      additionalProperties: false
    },
    message: { type: 'string', maxLength: 2000 }
  },
  additionalProperties: false
};

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
  const tableName = process.env.SEED_REQUESTS_TABLE_NAME;
  if (!tableName) {
    throw new Error('SEED_REQUESTS_TABLE_NAME is not configured');
  }
  return tableName;
}

export async function enforceSeedRequestRateLimit(sourceIp) {
  const ip = sourceIp || 'unknown';
  const windowSeconds = Number(process.env.SEED_REQUEST_RATE_LIMIT_WINDOW_SECONDS ?? 3600);
  const maxRequests = Number(process.env.SEED_REQUEST_RATE_LIMIT_MAX ?? 5);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = nowSeconds + windowSeconds;

  const tableName = getTableName();
  const key = { requestId: `ratelimit#${ip}` };
  const client = getDocClient();

  let count;
  try {
    // Attempt 1: start a fresh window (record absent, or the existing window has expired).
    // DynamoDB TTL deletion is asynchronous, so we can't rely on it to clear stale rows.
    const result = await client.send(new UpdateCommand({
      TableName: tableName,
      Key: key,
      UpdateExpression: 'SET #count = :one, #exp = :exp',
      ConditionExpression: 'attribute_not_exists(#count) OR #exp <= :now',
      ExpressionAttributeNames: { '#count': 'count', '#exp': 'expiresAt' },
      ExpressionAttributeValues: { ':one': 1, ':exp': expiresAt, ':now': nowSeconds },
      ReturnValues: 'ALL_NEW'
    }));
    count = Number(result.Attributes?.count ?? 0);
  } catch (error) {
    if (error?.name !== 'ConditionalCheckFailedException') {
      throw error;
    }
    // Attempt 2: window is live — increment without touching expiresAt.
    const result = await client.send(new UpdateCommand({
      TableName: tableName,
      Key: key,
      UpdateExpression: 'ADD #count :one',
      ConditionExpression: 'attribute_exists(#exp) AND #exp > :now',
      ExpressionAttributeNames: { '#count': 'count', '#exp': 'expiresAt' },
      ExpressionAttributeValues: { ':one': 1, ':now': nowSeconds },
      ReturnValues: 'ALL_NEW'
    }));
    count = Number(result.Attributes?.count ?? 0);
  }

  if (count > maxRequests) {
    const error = new Error('Too many seed requests from this IP. Please wait and try again later.');
    error.code = 'SEED_REQUEST_RATE_LIMITED';
    error.retryAfterSeconds = windowSeconds;
    throw error;
  }
}

function validateFulfillment(payload) {
  if (payload.fulfillmentMethod === 'mail') {
    const address = payload.shippingAddress;
    if (!address) {
      return 'shippingAddress is required when fulfillmentMethod is "mail"';
    }
    const requiredFields = ['line1', 'city', 'region', 'postalCode', 'country'];
    for (const field of requiredFields) {
      const value = address[field];
      if (typeof value !== 'string' || value.trim().length === 0) {
        return `shippingAddress.${field} is required`;
      }
    }
    if (!SUPPORTED_COUNTRIES.includes(address.country)) {
      return 'shippingAddress.country must be US or CA — we can only mail within those countries today';
    }
  }
  return null;
}

export function validateSeedRequest(payload) {
  return validateFulfillment(payload);
}

export async function createSeedRequest(payload, contributor) {
  const now = new Date();
  const requestId = randomUUID();
  const item = {
    requestId,
    createdAt: now.toISOString(),
    name: payload.name.trim(),
    email: payload.email.trim().toLowerCase(),
    fulfillmentMethod: payload.fulfillmentMethod,
    shippingAddress: payload.shippingAddress,
    visitDetails: payload.visitDetails,
    message: payload.message?.trim() || undefined,
    ...(contributor?.sub ? { contributorCognitoSub: contributor.sub } : {}),
    expiresAt: Math.floor(now.getTime() / 1000) + 60 * 60 * 24 * 365 * 5
  };

  await getDocClient().send(new PutCommand({
    TableName: getTableName(),
    Item: item,
    ConditionExpression: 'attribute_not_exists(requestId)'
  }));

  return item;
}

function slackText(request) {
  const lines = [':seedling: New okra seed request'];
  lines.push(`Name: ${request.name}`);
  lines.push(`Email: ${request.email}`);
  if (request.fulfillmentMethod === 'mail') {
    const a = request.shippingAddress ?? {};
    const addressLine = [a.line1, a.line2].filter(Boolean).join(', ');
    lines.push('Fulfillment: Mail');
    lines.push(`Address: ${addressLine}, ${a.city}, ${a.region} ${a.postalCode}, ${a.country}`);
  } else {
    lines.push('Fulfillment: In-person exchange');
    if (request.visitDetails?.approximateDate) {
      lines.push(`Visiting: ${request.visitDetails.approximateDate}`);
    }
    if (request.visitDetails?.notes) {
      lines.push(`Notes: ${request.visitDetails.notes}`);
    }
  }
  if (request.message) {
    lines.push(`Message: ${request.message}`);
  }
  if (request.contributorCognitoSub) {
    lines.push(`Signed-in user: ${request.contributorCognitoSub}`);
  } else {
    lines.push('Signed-in user: (anonymous)');
  }
  return lines.join('\n');
}

export async function notifySeedRequestSlack(request, correlationId) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl?.trim()) {
    return;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: slackText(request) })
    });
    if (!response.ok) {
      console.error(JSON.stringify({
        level: 'error',
        correlationId,
        status: response.status,
        message: 'Seed request Slack webhook returned non-success'
      }));
    }
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      correlationId,
      message: 'Seed request Slack webhook request failed',
      error: error instanceof Error ? error.message : String(error)
    }));
  }
}
