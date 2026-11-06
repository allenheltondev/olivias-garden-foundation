import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, ScanCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { createDbClient } from '../../scripts/db-client.mjs';
import {
  buildSeedShipmentPin,
  deleteSeedShipmentPin,
  getSeedShipmentPinsByRequestId,
  insertSeedShipmentPin,
} from './seed-shipment-pins.mjs';

/**
 * Admin-side seed request lifecycle:
 *
 *   open ──handled──▶ handled   (counts a packet sent, may add a map pin)
 *   open ──cancelled─▶ cancelled (no packet counted, no pin)
 *   handled ──open──▶ open      (undo: un-counts the packet, removes the pin)
 *   cancelled ──open─▶ open     (reopen)
 *
 * DynamoDB holds the transactional truth; the Postgres map pin is a public
 * projection that is written/removed after the state change succeeds.
 */

export const SEED_REQUEST_STATUSES = ['open', 'handled', 'cancelled'];
export const SEED_PACKETS_SENT_COUNTER_KEY = 'stats#seed-packets-sent';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export class SeedRequestTransitionError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function getSeedRequestsTableName() {
  const tableName = process.env.SEED_REQUESTS_TABLE_NAME;
  if (!tableName) {
    throw new Error('SEED_REQUESTS_TABLE_NAME is not configured');
  }
  return tableName;
}

function logError(message, err, extra = {}) {
  console.error(JSON.stringify({
    level: 'error',
    message,
    error: err instanceof Error ? err.message : String(err),
    errorName: err instanceof Error ? err.name : 'UnknownError',
    ...extra,
  }));
}

function statusOf(item) {
  return item?.requestStatus ?? 'open';
}

function isRequestRecord(item) {
  const requestId = String(item.requestId ?? '');
  return Boolean(item.createdAt) && !requestId.startsWith('stats#') && !requestId.startsWith('ratelimit#');
}

function sortKeyFor(status, item) {
  if (status === 'handled') return String(item.handledAt ?? item.createdAt ?? '');
  if (status === 'cancelled') return String(item.cancelledAt ?? item.createdAt ?? '');
  return String(item.createdAt ?? '');
}

function toQueueItem(item) {
  return {
    id: item.requestId,
    name: item.name ?? null,
    email: item.email ?? null,
    fulfillmentMethod: item.fulfillmentMethod ?? null,
    shippingAddress: item.shippingAddress ?? null,
    visitDetails: item.visitDetails ?? null,
    message: item.message ?? null,
    createdAt: item.createdAt ?? null,
    requestStatus: statusOf(item),
    handledAt: item.handledAt ?? null,
    cancelledAt: item.cancelledAt ?? null,
    reviewNotes: item.reviewNotes ?? null,
  };
}

async function scanAll(params) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const result = await dynamo.send(new ScanCommand({ ...params, ExclusiveStartKey }));
    items.push(...(result.Items ?? []));
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

/** All requests in `status`, newest first (by the time they entered it). */
export async function listSeedRequests(status) {
  const isOpen = status === 'open';
  const items = await scanAll({
    TableName: getSeedRequestsTableName(),
    FilterExpression: isOpen
      ? 'attribute_exists(createdAt) AND (attribute_not_exists(#status) OR #status = :status)'
      : 'attribute_exists(createdAt) AND #status = :status',
    ExpressionAttributeNames: { '#status': 'requestStatus' },
    ExpressionAttributeValues: { ':status': status },
  });

  return items
    .filter(isRequestRecord)
    .sort((a, b) => sortKeyFor(status, b).localeCompare(sortKeyFor(status, a)))
    .map(toQueueItem);
}

/**
 * Adds `mapPin` ({ locality, country } or null) to each item. If the pin
 * store is unreachable, items are returned with `mapPin` left undefined so
 * the UI can say "unknown" rather than wrongly claiming there is no pin.
 */
export async function attachMapPins(items) {
  if (items.length === 0) return items;
  let client;
  try {
    client = await createDbClient();
    await client.connect();
    const pins = await getSeedShipmentPinsByRequestId(client, items.map((item) => item.id));
    return items.map((item) => ({ ...item, mapPin: pins.get(item.id) ?? null }));
  } catch (err) {
    logError('Failed to load seed shipment pins for admin list', err, { endpoint: 'GET /admin/requests' });
    return items;
  } finally {
    if (client) await client.end();
  }
}

export async function getSeedRequest(requestId) {
  const result = await dynamo.send(new GetCommand({
    TableName: getSeedRequestsTableName(),
    Key: { requestId },
  }));
  const item = result.Item ?? null;
  return item && isRequestRecord(item) ? item : null;
}

async function withPinStore(fn) {
  const client = await createDbClient();
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Put a public-safe pin on the okra map for a mailed seed request. A failure
 * is logged and reported as null instead of failing the transition, because
 * the seeds really did go out.
 */
async function recordSeedShipmentPin(requestId, mapLocation, sentAt) {
  if (!mapLocation) return null;
  try {
    const seedRequest = await getSeedRequest(requestId);
    const pin = buildSeedShipmentPin(seedRequest, mapLocation, sentAt);
    if (!pin) return null;
    await withPinStore((client) => insertSeedShipmentPin(client, pin));
    return { locality: pin.locality, country: pin.country };
  } catch (err) {
    logError('Failed to record seed shipment map pin', err, {
      endpoint: 'POST /admin/requests/:id/statuses',
      requestId,
    });
    return null;
  }
}

/** Idempotent pin removal. Returns true/false, or null if the store failed. */
export async function removeSeedShipmentPin(requestId, endpoint) {
  try {
    return await withPinStore((client) => deleteSeedShipmentPin(client, requestId));
  } catch (err) {
    logError('Failed to remove seed shipment map pin', err, { endpoint, requestId });
    return null;
  }
}

function counterUpdate(delta, updatedAt) {
  return {
    Update: {
      TableName: getSeedRequestsTableName(),
      Key: { requestId: SEED_PACKETS_SENT_COUNTER_KEY },
      UpdateExpression: 'ADD #count :delta SET #entityType = if_not_exists(#entityType, :entityType), #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#count': 'count',
        '#entityType': 'entityType',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':delta': delta,
        ':entityType': 'seed_packet_stats',
        ':updatedAt': updatedAt,
      },
    },
  };
}

function isConditionFailure(err) {
  return err?.name === 'ConditionalCheckFailedException' || err?.name === 'TransactionCanceledException';
}

async function runTransition(transactItems) {
  try {
    await dynamo.send(new TransactWriteCommand({ TransactItems: transactItems }));
  } catch (err) {
    if (isConditionFailure(err)) {
      throw new SeedRequestTransitionError(
        'INVALID_STATE',
        'Seed request changed or is missing — refresh and try again'
      );
    }
    throw err;
  }
}

/** open → handled */
export async function markSeedRequestHandled(requestId, cognitoSub, reviewNotes, mapLocation) {
  const handledAt = new Date().toISOString();

  await runTransition([
    {
      Update: {
        TableName: getSeedRequestsTableName(),
        Key: { requestId },
        UpdateExpression: 'SET #status = :handled, #handledAt = :handledAt, #handledBy = :handledBy, #notes = :notes',
        ConditionExpression: 'attribute_exists(requestId) AND attribute_exists(createdAt) AND (attribute_not_exists(#status) OR #status = :open)',
        ExpressionAttributeNames: {
          '#status': 'requestStatus',
          '#handledAt': 'handledAt',
          '#handledBy': 'handledByCognitoSub',
          '#notes': 'reviewNotes',
        },
        ExpressionAttributeValues: {
          ':handled': 'handled',
          ':handledAt': handledAt,
          ':handledBy': cognitoSub,
          ':notes': reviewNotes ?? null,
          ':open': 'open',
        },
      },
    },
    counterUpdate(1, handledAt),
  ]);

  const mapPin = await recordSeedShipmentPin(requestId, mapLocation, handledAt);

  return {
    id: requestId,
    requestStatus: 'handled',
    handledAt,
    handledByCognitoSub: cognitoSub,
    reviewNotes: reviewNotes ?? null,
    mapPin,
  };
}

/** open → cancelled. No packet is counted and no pin is created. */
export async function cancelSeedRequest(requestId, cognitoSub, reviewNotes) {
  const cancelledAt = new Date().toISOString();

  await runTransition([
    {
      Update: {
        TableName: getSeedRequestsTableName(),
        Key: { requestId },
        UpdateExpression: 'SET #status = :cancelled, #cancelledAt = :cancelledAt, #cancelledBy = :cancelledBy, #notes = :notes',
        ConditionExpression: 'attribute_exists(requestId) AND attribute_exists(createdAt) AND (attribute_not_exists(#status) OR #status = :open)',
        ExpressionAttributeNames: {
          '#status': 'requestStatus',
          '#cancelledAt': 'cancelledAt',
          '#cancelledBy': 'cancelledByCognitoSub',
          '#notes': 'reviewNotes',
        },
        ExpressionAttributeValues: {
          ':cancelled': 'cancelled',
          ':cancelledAt': cancelledAt,
          ':cancelledBy': cognitoSub,
          ':notes': reviewNotes ?? null,
          ':open': 'open',
        },
      },
    },
  ]);

  return {
    id: requestId,
    requestStatus: 'cancelled',
    cancelledAt,
    cancelledByCognitoSub: cognitoSub,
    reviewNotes: reviewNotes ?? null,
  };
}

/**
 * handled → open (undo): un-counts the packet and removes the map pin.
 * cancelled → open (reopen).
 */
export async function reopenSeedRequest(requestId, cognitoSub, reviewNotes) {
  const current = await getSeedRequest(requestId);
  if (!current) {
    throw new SeedRequestTransitionError('NOT_FOUND', 'Seed request not found');
  }
  const fromStatus = statusOf(current);
  if (fromStatus === 'open') {
    throw new SeedRequestTransitionError('INVALID_STATE', 'Seed request is already open');
  }

  const reopenedAt = new Date().toISOString();
  const removeFields = fromStatus === 'handled'
    ? 'REMOVE #handledAt, #handledBy'
    : 'REMOVE #cancelledAt, #cancelledBy';
  const names = fromStatus === 'handled'
    ? { '#handledAt': 'handledAt', '#handledBy': 'handledByCognitoSub' }
    : { '#cancelledAt': 'cancelledAt', '#cancelledBy': 'cancelledByCognitoSub' };
  const notesClause = reviewNotes !== undefined ? ', #notes = :notes' : '';

  const transactItems = [
    {
      Update: {
        TableName: getSeedRequestsTableName(),
        Key: { requestId },
        UpdateExpression: `SET #status = :open, #reopenedAt = :reopenedAt, #reopenedBy = :reopenedBy${notesClause} ${removeFields}`,
        // Guard against a concurrent transition between our read and write.
        ConditionExpression: '#status = :from',
        ExpressionAttributeNames: {
          '#status': 'requestStatus',
          '#reopenedAt': 'reopenedAt',
          '#reopenedBy': 'reopenedByCognitoSub',
          ...(reviewNotes !== undefined ? { '#notes': 'reviewNotes' } : {}),
          ...names,
        },
        ExpressionAttributeValues: {
          ':open': 'open',
          ':from': fromStatus,
          ':reopenedAt': reopenedAt,
          ':reopenedBy': cognitoSub,
          ...(reviewNotes !== undefined ? { ':notes': reviewNotes ?? null } : {}),
        },
      },
    },
  ];
  if (fromStatus === 'handled') {
    transactItems.push(counterUpdate(-1, reopenedAt));
  }

  await runTransition(transactItems);

  // Always attempt removal so a stale pin can't outlive an undo.
  const mapPinRemoved = await removeSeedShipmentPin(requestId, 'POST /admin/requests/:id/statuses');

  return {
    id: requestId,
    requestStatus: 'open',
    previousStatus: fromStatus,
    reopenedAt,
    reopenedByCognitoSub: cognitoSub,
    mapPinRemoved,
  };
}
