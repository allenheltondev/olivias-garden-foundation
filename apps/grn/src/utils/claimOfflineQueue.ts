import type { Claim, CreateClaimPayload, TransitionClaimPayload } from '../types/claim';

const CLAIM_QUEUE_STORAGE_KEY = 'claim-queue-v1';

export interface QueuedCreateClaimAction {
  id: string;
  type: 'create';
  createdAt: string;
  localClaimId: string;
  payload: CreateClaimPayload;
}

export interface QueuedTransitionClaimAction {
  id: string;
  type: 'transition';
  createdAt: string;
  claimId: string;
  payload: TransitionClaimPayload;
}

export type QueuedClaimAction = QueuedCreateClaimAction | QueuedTransitionClaimAction;

export interface ProcessedQueuedClaimAction {
  actionId: string;
  claim: Claim;
  replaceClaimId?: string;
}

export interface ReplayQueuedClaimActionsResult {
  processed: ProcessedQueuedClaimAction[];
  failed: QueuedClaimAction[];
}

interface ReplayQueuedClaimActionsOptions {
  viewerUserId?: string;
  createClaimHandler: (payload: CreateClaimPayload) => Promise<Claim>;
  transitionClaimHandler: (claimId: string, payload: TransitionClaimPayload) => Promise<Claim>;
}

function resolveQueueStorageKey(viewerUserId?: string): string {
  return viewerUserId ? `${CLAIM_QUEUE_STORAGE_KEY}:${viewerUserId}` : CLAIM_QUEUE_STORAGE_KEY;
}

function makeQueueActionId(): string {
  return `claim-action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isQueuedClaimAction(value: unknown): value is QueuedClaimAction {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (record.type !== 'create' && record.type !== 'transition') {
    return false;
  }

  if (typeof record.id !== 'string' || typeof record.createdAt !== 'string') {
    return false;
  }

  if (record.type === 'create') {
    return typeof record.localClaimId === 'string' && typeof record.payload === 'object';
  }

  return typeof record.claimId === 'string' && typeof record.payload === 'object';
}

function loadQueue(viewerUserId?: string): QueuedClaimAction[] {
  try {
    const key = resolveQueueStorageKey(viewerUserId);
    const serialized = window.localStorage.getItem(key);
    if (!serialized) {
      return [];
    }

    const parsed = JSON.parse(serialized);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isQueuedClaimAction);
  } catch {
    return [];
  }
}

function saveQueue(actions: QueuedClaimAction[], viewerUserId?: string): void {
  try {
    const key = resolveQueueStorageKey(viewerUserId);
    if (actions.length === 0) {
      window.localStorage.removeItem(key);
      return;
    }

    window.localStorage.setItem(key, JSON.stringify(actions));
  } catch {
    // Ignore localStorage write failures in restricted environments.
  }
}

export function enqueueCreateClaimAction(
  payload: CreateClaimPayload,
  localClaimId: string,
  viewerUserId?: string
): QueuedCreateClaimAction {
  const queuedAction: QueuedCreateClaimAction = {
    id: makeQueueActionId(),
    type: 'create',
    createdAt: new Date().toISOString(),
    localClaimId,
    payload,
  };

  const current = loadQueue(viewerUserId);
  saveQueue([...current, queuedAction], viewerUserId);
  return queuedAction;
}

export function enqueueTransitionClaimAction(
  claimId: string,
  payload: TransitionClaimPayload,
  viewerUserId?: string
): QueuedTransitionClaimAction {
  const queuedAction: QueuedTransitionClaimAction = {
    id: makeQueueActionId(),
    type: 'transition',
    createdAt: new Date().toISOString(),
    claimId,
    payload,
  };

  const current = loadQueue(viewerUserId);
  saveQueue([...current, queuedAction], viewerUserId);
  return queuedAction;
}

export function hasQueuedClaimActions(viewerUserId?: string): boolean {
  return loadQueue(viewerUserId).length > 0;
}

function isLocalClaimId(value: string): boolean {
  return value.startsWith('local-claim-');
}

export async function replayQueuedClaimActions({
  viewerUserId,
  createClaimHandler,
  transitionClaimHandler,
}: ReplayQueuedClaimActionsOptions): Promise<ReplayQueuedClaimActionsResult> {
  const queuedActions = loadQueue(viewerUserId);
  if (queuedActions.length === 0) {
    return { processed: [], failed: [] };
  }

  const processed: ProcessedQueuedClaimAction[] = [];
  const localToServerClaimId = new Map<string, string>();

  for (let index = 0; index < queuedActions.length; index += 1) {
    const action = queuedActions[index];

    try {
      if (action.type === 'create') {
        const created = await createClaimHandler(action.payload);
        localToServerClaimId.set(action.localClaimId, created.id);
        processed.push({ actionId: action.id, claim: created, replaceClaimId: action.localClaimId });
      } else {
        const resolvedClaimId =
          localToServerClaimId.get(action.claimId) ?? action.claimId;

        if (isLocalClaimId(resolvedClaimId)) {
          throw new Error('Queued transition references an unsynced local claim ID.');
        }

        const updated = await transitionClaimHandler(resolvedClaimId, action.payload);
        processed.push({ actionId: action.id, claim: updated, replaceClaimId: action.claimId });
      }
    } catch {
      // Preserve ordering and keep current+remaining actions queued for replay.
      const remaining = queuedActions.slice(index);
      saveQueue(remaining, viewerUserId);
      return { processed, failed: remaining };
    }
  }

  saveQueue([], viewerUserId);
  return { processed, failed: [] };
}
