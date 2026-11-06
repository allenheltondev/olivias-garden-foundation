import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, ScanCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { createDbClient } from '../../scripts/db-client.mjs';
import {
  buildSeedShipmentPin,
  getSeedShipmentPinsByRequestId,
  pinVisibility,
  hideSeedShipmentPin,
  upsertSeedShipmentPin,
} from './seed-shipment-pins.mjs';

/**
 * Admin-side seed request lifecycle:
 *
 *   open ──handled──▶ handled   (counts a packet sent, may add a map pin)
 *   open ──cancelled─▶ cancelled (no packet counted, no pin)
 *   handled ──open──▶ open      (undo: un-counts the packet, hides the pin)
 *   cancelled ──open─▶ open     (reopen)
 *
 * DynamoDB holds the transactional truth. The public map pin lives in
 * Postgres, so the two can't commit together. Instead every change to a
 * request bumps its `statusVersion` (optimistic concurrency: the write is
 * conditional on the version we read), and each pin write carries the
 * version it was derived from. Postgres only applies a pin write that is
 * newer than what it holds, so projection writes can land in any order and
 * the latest state still wins — a slow "handled" insert can't resurrect a
 * pin that a later undo hid.
 */

export const SEED_REQUEST_STATUSES = ['open', 'handled', 'cancelled'];
export const SEED_PACKETS_SENT_COUNTER_KEY = 'stats#seed-packets-sent';

const PIN_WRITE_ATTEMPTS = 3;

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

function log(level, message, extra = {}, err) {
  const payload = { level, message, ...extra };
  if (err !== undefined) {
    payload.error = err instanceof Error ? err.message : String(err);
    payload.errorName = err instanceof Error ? err.name : 'UnknownError';
  }
  const line = JSON.stringify(payload);
  if (level === 'error') console.error(line);
  else console.warn(line);
}

function statusOf(item) {
  return item?.requestStatus ?? 'open';
}

function versionOf(item) {
  const v = Number(item?.statusVersion ?? 0);
  return Number.isInteger(v) && v >= 0 ? v : 0;
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
    showOnMap: item.showOnMap === true,
    pinVisibility: pinVisibility(item),
    statusVersion: versionOf(item),
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
 * Adds `mapPin` ({ locality, country } or null) to each item, and reconciles
 * as it goes: a visible pin on a request that isn't handled, or that may not
 * have a pin at all, is hidden at the request's current version. That cleans up a pin left behind
 * if a hide failed after an undo.
 *
 * If the pin store is unreachable, items come back with `mapPin` undefined so
 * the UI can say "unknown" rather than wrongly claiming there is no pin.
 */
export async function attachMapPins(items) {
  if (items.length === 0) return items;
  try {
    return await withPinStore(async (client) => {
      const pins = await getSeedShipmentPinsByRequestId(client, items.map((item) => item.id));
      const out = [];
      for (const item of items) {
        const pin = pins.get(item.id) ?? null;
        const shouldBeVisible = item.requestStatus === 'handled' && item.pinVisibility !== 'none';
        if (pin && !shouldBeVisible) {
          await hideSeedShipmentPin(client, item.id, item.statusVersion);
          log('warn', 'Reconciled stale seed shipment pin', {
            endpoint: 'GET /admin/requests',
            requestId: item.id,
            requestStatus: item.requestStatus,
            statusVersion: item.statusVersion,
          });
          out.push({ ...item, mapPin: null });
        } else {
          out.push({ ...item, mapPin: pin });
        }
      }
      return out;
    });
  } catch (err) {
    log('error', 'Failed to load seed shipment pins for admin list', { endpoint: 'GET /admin/requests' }, err);
    return items;
  }
}

export async function getSeedRequest(requestId) {
  const result = await dynamo.send(new GetCommand({
    TableName: getSeedRequestsTableName(),
    Key: { requestId },
    ConsistentRead: true,
  }));
  const item = result.Item ?? null;
  return item && isRequestRecord(item) ? item : null;
}

async function requireSeedRequest(requestId) {
  const current = await getSeedRequest(requestId);
  if (!current) {
    throw new SeedRequestTransitionError('NOT_FOUND', 'Seed request not found');
  }
  return current;
}

/**
 * Run a pin projection write, retrying briefly. Returns the write's result,
 * or null if every attempt failed (logged). Writes are version-guarded, so a
 * retry can't overwrite newer state.
 */
async function projectPin(write, context) {
  let lastError;
  for (let attempt = 1; attempt <= PIN_WRITE_ATTEMPTS; attempt++) {
    try {
      return await withPinStore(write);
    } catch (err) {
      lastError = err;
      if (attempt < PIN_WRITE_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
      }
    }
  }
  log('error', 'Seed shipment pin projection failed', context, lastError);
  return null;
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

/**
 * A request update conditioned on both the status and the version we read.
 * Legacy items have no statusVersion and read as 0.
 */
function versionedRequestUpdate(requestId, current, { set, remove = [], names = {}, values = {} }) {
  const expected = versionOf(current);
  const fromStatus = statusOf(current);
  const statusCondition = fromStatus === 'open'
    ? '(attribute_not_exists(#status) OR #status = :fromStatus)'
    : '#status = :fromStatus';
  const versionCondition = expected === 0
    ? '(attribute_not_exists(#version) OR #version = :expectedVersion)'
    : '#version = :expectedVersion';
  const removeClause = remove.length > 0 ? ` REMOVE ${remove.join(', ')}` : '';

  return {
    nextVersion: expected + 1,
    update: {
      Update: {
        TableName: getSeedRequestsTableName(),
        Key: { requestId },
        UpdateExpression: `SET ${[...set, '#version = :nextVersion'].join(', ')}${removeClause}`,
        ConditionExpression: `attribute_exists(createdAt) AND ${statusCondition} AND ${versionCondition}`,
        ExpressionAttributeNames: { '#status': 'requestStatus', '#version': 'statusVersion', ...names },
        ExpressionAttributeValues: {
          ':fromStatus': fromStatus,
          ':expectedVersion': expected,
          ':nextVersion': expected + 1,
          ...values,
        },
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

function requireStatus(current, allowed, message) {
  if (!allowed.includes(statusOf(current))) {
    throw new SeedRequestTransitionError('INVALID_STATE', message);
  }
}

/** open → handled */
export async function markSeedRequestHandled(requestId, cognitoSub, reviewNotes, mapLocation) {
  const current = await requireSeedRequest(requestId);
  requireStatus(current, ['open'], 'Seed request is already handled or cancelled');

  const handledAt = new Date().toISOString();
  const { nextVersion, update } = versionedRequestUpdate(requestId, current, {
    set: ['#status = :handled', '#handledAt = :handledAt', '#handledBy = :handledBy', '#notes = :notes'],
    names: { '#handledAt': 'handledAt', '#handledBy': 'handledByCognitoSub', '#notes': 'reviewNotes' },
    values: { ':handled': 'handled', ':handledAt': handledAt, ':handledBy': cognitoSub, ':notes': reviewNotes ?? null },
  });
  await runTransition([update, counterUpdate(1, handledAt)]);

  // Derive the pin from the state we just committed, at its version.
  const pin = buildSeedShipmentPin(
    { ...current, requestStatus: 'handled' },
    mapLocation,
    handledAt,
    nextVersion
  );
  let mapPin = null;
  if (pin) {
    const written = await projectPin(
      (client) => upsertSeedShipmentPin(client, pin),
      { endpoint: 'POST /admin/requests/:id/statuses', requestId, statusVersion: nextVersion, op: 'show' }
    );
    // `false` means a newer state already superseded this one — no pin.
    mapPin = written ? { locality: pin.locality, country: pin.country } : null;
  }

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
  const current = await requireSeedRequest(requestId);
  requireStatus(current, ['open'], 'Only open requests can be cancelled');

  const cancelledAt = new Date().toISOString();
  const { update } = versionedRequestUpdate(requestId, current, {
    set: ['#status = :cancelled', '#cancelledAt = :cancelledAt', '#cancelledBy = :cancelledBy', '#notes = :notes'],
    names: { '#cancelledAt': 'cancelledAt', '#cancelledBy': 'cancelledByCognitoSub', '#notes': 'reviewNotes' },
    values: { ':cancelled': 'cancelled', ':cancelledAt': cancelledAt, ':cancelledBy': cognitoSub, ':notes': reviewNotes ?? null },
  });
  await runTransition([update]);

  return {
    id: requestId,
    requestStatus: 'cancelled',
    cancelledAt,
    cancelledByCognitoSub: cognitoSub,
    reviewNotes: reviewNotes ?? null,
  };
}

/**
 * handled → open (undo): un-counts the packet and hides the map pin.
 * cancelled → open (reopen).
 */
export async function reopenSeedRequest(requestId, cognitoSub, reviewNotes) {
  const current = await requireSeedRequest(requestId);
  const fromStatus = statusOf(current);
  if (fromStatus === 'open') {
    throw new SeedRequestTransitionError('INVALID_STATE', 'Seed request is already open');
  }

  const reopenedAt = new Date().toISOString();
  const fromHandled = fromStatus === 'handled';
  const { nextVersion, update } = versionedRequestUpdate(requestId, current, {
    set: [
      '#status = :open',
      '#reopenedAt = :reopenedAt',
      '#reopenedBy = :reopenedBy',
      ...(reviewNotes !== undefined ? ['#notes = :notes'] : []),
    ],
    remove: fromHandled ? ['#handledAt', '#handledBy'] : ['#cancelledAt', '#cancelledBy'],
    names: {
      '#reopenedAt': 'reopenedAt',
      '#reopenedBy': 'reopenedByCognitoSub',
      ...(reviewNotes !== undefined ? { '#notes': 'reviewNotes' } : {}),
      ...(fromHandled
        ? { '#handledAt': 'handledAt', '#handledBy': 'handledByCognitoSub' }
        : { '#cancelledAt': 'cancelledAt', '#cancelledBy': 'cancelledByCognitoSub' }),
    },
    values: {
      ':open': 'open',
      ':reopenedAt': reopenedAt,
      ':reopenedBy': cognitoSub,
      ...(reviewNotes !== undefined ? { ':notes': reviewNotes ?? null } : {}),
    },
  });
  const transactItems = [update];
  if (fromHandled) transactItems.push(counterUpdate(-1, reopenedAt));
  await runTransition(transactItems);

  // Always hide at the new version, even if no pin exists yet: the tombstone
  // blocks a "handled" insert that's still in flight from landing later.
  const mapPinRemoved = await projectPin(
    (client) => hideSeedShipmentPin(client, requestId, nextVersion),
    { endpoint: 'POST /admin/requests/:id/statuses', requestId, statusVersion: nextVersion, op: 'hide' }
  );

  return {
    id: requestId,
    requestStatus: 'open',
    previousStatus: fromStatus,
    reopenedAt,
    reopenedByCognitoSub: cognitoSub,
    mapPinRemoved,
  };
}

/**
 * Put a pin on the map for a request that's already done, e.g. one marked
 * done before pins existed, or whose pin was removed. Bumps the version so
 * this write outranks any earlier pin write for the request.
 * Returns { locality, country } when the pin is visible, null when the
 * request can't have one (in-person) or a newer state superseded it.
 */
export async function addSeedRequestMapPin(requestId, mapLocation) {
  const current = await requireSeedRequest(requestId);
  requireStatus(current, ['handled'], 'Only done requests can be added to the map');
  if (pinVisibility(current) === 'none') {
    throw new SeedRequestTransitionError(
      'INVALID_STATE',
      current.fulfillmentMethod === 'mail'
        ? 'This requester was told they would not get a map pin'
        : 'In-person exchanges are not shown on the map'
    );
  }

  const { nextVersion, update } = versionedRequestUpdate(requestId, current, {
    set: ['#pinAddedAt = :pinAddedAt'],
    names: { '#pinAddedAt': 'mapPinAddedAt' },
    values: { ':pinAddedAt': new Date().toISOString() },
  });
  await runTransition([update]);

  // Month shown on the map is when the seeds went out, not when the pin was added.
  const pin = buildSeedShipmentPin(current, mapLocation, current.handledAt ?? new Date().toISOString(), nextVersion);
  if (!pin) return null;
  const written = await projectPin(
    (client) => upsertSeedShipmentPin(client, pin),
    { endpoint: 'POST /admin/requests/:id/map-pin', requestId, statusVersion: nextVersion, op: 'show' }
  );
  if (written === null) {
    throw new Error('Could not write the map pin');
  }
  return written ? { locality: pin.locality, country: pin.country } : null;
}

/**
 * Hide a request's pin without changing its status. Bumps the version so the
 * hide outranks any pin write derived from the earlier state.
 * Returns true/false for whether a visible pin was hidden, or null if the
 * pin store failed.
 */
export async function removeSeedRequestMapPin(requestId) {
  const current = await requireSeedRequest(requestId);
  const { nextVersion, update } = versionedRequestUpdate(requestId, current, {
    set: ['#pinRemovedAt = :pinRemovedAt'],
    names: { '#pinRemovedAt': 'mapPinRemovedAt' },
    values: { ':pinRemovedAt': new Date().toISOString() },
  });
  await runTransition([update]);

  return projectPin(
    (client) => hideSeedShipmentPin(client, requestId, nextVersion),
    { endpoint: 'DELETE /admin/requests/:id/map-pin', requestId, statusVersion: nextVersion, op: 'hide' }
  );
}
