/**
 * API keys for the operator MCP server (docs/mcp-server.md, "Keys").
 *
 * After kids-and-dragons' MCP keys: a row per key with a label, its scopes,
 * when it was made, when it expires and when it was last used. The key is
 * shown once at mint and never stored; the row keeps the SHA-256 of its secret
 * half (32 random bytes, so a plain hash is the right tool). Revoking deletes
 * the row and the next request with it is refused.
 *
 * One addition: a key acts **as an operator**. It carries the Cognito sub,
 * username and email of an admin user, checked at mint (the user must be in
 * the admin group) and re-checked on every request (handler.mjs). Every write
 * a tool makes is attributed to that person in the owning service's audit
 * trail, exactly as if they had clicked the button in the admin app.
 *
 * Minted only by someone with AWS credentials (`npm run mcp:keys`), never
 * over the internet: no tool can mint a key, and a key cannot mint another.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Areas group the tools. `<area>:write` reaches every tool in an area;
 * `<area>:read` reaches only the tools annotated readOnlyHint.
 */
export const AREAS = ['store', 'workshops', 'content', 'queues', 'reports'];
export const SCOPES = AREAS.flatMap((area) => [`${area}:read`, `${area}:write`]);

export const KEY_PREFIX = 'ogfmcp_';
const KEY_SHAPE = /^ogfmcp_([0-9a-f]{16})\.([A-Za-z0-9_-]{43})$/;

export const DEFAULT_KEY_DAYS = 90;
export const MAX_KEY_DAYS = 366;
const LABEL_MAX = 60;
const LABEL_SHAPE = /^[A-Za-z0-9 ._:/-]+$/;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class KeyError extends Error {}

function hashSecret(secret) {
  return createHash('sha256').update(secret).digest('hex');
}

export function isScope(value) {
  return SCOPES.includes(value);
}

/** `all:read` / `all:write` expand to that level in every area. */
export function expandScopes(scopes) {
  return scopes.flatMap((scope) => {
    if (scope === 'all:read') return AREAS.map((a) => `${a}:read`);
    if (scope === 'all:write') return AREAS.map((a) => `${a}:write`);
    return [scope];
  });
}

/** The row without its hash: what `list` and `create` show. */
export function publicInfo(record) {
  const info = { ...record };
  delete info.secretHash;
  return info;
}

function validateOperator(operator) {
  if (!operator || typeof operator !== 'object') {
    throw new KeyError('A key acts as an admin user: name one with --operator <email>.');
  }
  if (typeof operator.sub !== 'string' || !UUID_SHAPE.test(operator.sub)) {
    throw new KeyError('The operator needs a Cognito sub (a UUID).');
  }
  if (typeof operator.username !== 'string' || operator.username.length === 0) {
    throw new KeyError('The operator needs a Cognito username.');
  }
  return {
    sub: operator.sub.toLowerCase(),
    username: operator.username,
    email: typeof operator.email === 'string' && operator.email ? operator.email : null
  };
}

/** Make a key. The returned `key` is the only copy that will ever exist. */
export async function mintKey(store, input) {
  const label = String(input.label ?? '').trim();
  if (!label || label.length > LABEL_MAX) {
    throw new KeyError(`A label of 1 to ${LABEL_MAX} characters says who holds the key.`);
  }
  if (!LABEL_SHAPE.test(label)) {
    throw new KeyError('A label is plain words (letters, digits, spaces, . _ : / -).');
  }
  const scopes = expandScopes(input.scopes ?? []);
  if (scopes.length === 0) throw new KeyError(`Name at least one scope: ${SCOPES.join(', ')}.`);
  const bad = scopes.filter((s) => !isScope(s));
  if (bad.length > 0) throw new KeyError(`Unknown scope ${bad.join(', ')}. Scopes: ${SCOPES.join(', ')}, all:read, all:write.`);
  const operator = validateOperator(input.operator);
  const days = input.days ?? DEFAULT_KEY_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > MAX_KEY_DAYS) {
    throw new KeyError(`A key lives 1 to ${MAX_KEY_DAYS} days.`);
  }

  const now = input.now ?? new Date();
  // Hex so an id is safe to type on a command line (never starts with "-").
  const id = randomBytes(8).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  const record = {
    id,
    label,
    scopes: [...new Set(scopes)].sort(),
    operator,
    secretHash: hashSecret(secret),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + days * 86_400_000).toISOString(),
    lastUsedAt: null
  };
  await store.create(record);
  return { key: `${KEY_PREFIX}${id}.${secret}`, info: publicInfo(record) };
}

/**
 * The key's grant, or null for anything that is not a live key. Malformed,
 * unknown, revoked, expired and wrong-secret keys all look the same to the
 * caller. Records the use; failing to record it never fails the call.
 */
export async function verifyKey(store, presented, now = new Date()) {
  const match = KEY_SHAPE.exec(presented ?? '');
  if (!match) return null;
  const [, id, secret] = match;
  const record = await store.get(id);
  if (!record) return null;
  const want = Buffer.from(record.secretHash, 'hex');
  const got = Buffer.from(hashSecret(secret), 'hex');
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  if (Date.parse(record.expiresAt) <= now.getTime()) return null;
  if (!record.operator?.sub) return null;
  await store.touch(id, now.toISOString()).catch(() => undefined);
  return {
    id: record.id,
    label: record.label,
    scopes: (record.scopes ?? []).filter(isScope),
    operator: record.operator,
    expiresAt: record.expiresAt
  };
}

export async function listKeys(store) {
  const rows = await store.list();
  return rows.map(publicInfo).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function revokeKey(store, id) {
  if (!(await store.delete(id))) throw new KeyError(`No key ${id}.`);
}

/** The bearer key from an Authorization header value, or null. */
export function bearerKey(header) {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
  return match ? match[1] : null;
}

export class MemoryKeyStore {
  constructor() {
    this.rows = new Map();
  }
  async get(id) {
    const row = this.rows.get(id);
    return row ? structuredClone(row) : null;
  }
  async create(record) {
    if (this.rows.has(record.id)) throw new KeyError('id taken');
    this.rows.set(record.id, structuredClone(record));
  }
  async list() {
    return [...this.rows.values()].map((r) => structuredClone(r));
  }
  async delete(id) {
    return this.rows.delete(id);
  }
  async touch(id, at) {
    const row = this.rows.get(id);
    if (row) row.lastUsedAt = at;
  }
}
