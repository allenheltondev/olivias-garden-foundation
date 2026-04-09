import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { PATHS, PERMAPEOPLE } from './config.mjs';

const runStats = { hits: 0, misses: 0 };
let lastApiCallAt = 0;

function safeKey(searchTerm) {
  return String(searchTerm || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'empty';
}

function cachePath(searchTerm, config = {}) {
  const dir = config.cacheDir || PATHS.permapeopleCacheDir;
  return path.join(dir, `${safeKey(searchTerm)}.json`);
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function sleep(ms) {
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}

async function applyRequestSpacing(config = {}) {
  const delay = config.requestDelayMs ?? PERMAPEOPLE.requestDelayMs;
  const elapsed = Date.now() - lastApiCallAt;
  if (lastApiCallAt > 0 && elapsed < delay) {
    await sleep(delay - elapsed);
  }
}

async function apiSearch(searchTerm, config = {}) {
  const endpoint = config.endpoint || PERMAPEOPLE.endpoint;
  const hitsPerPage = config.hitsPerPage ?? PERMAPEOPLE.hitsPerPage;
  const retries = config.retries ?? PERMAPEOPLE.retries;
  const backoffMs = config.backoffMs ?? PERMAPEOPLE.backoffMs;
  const rateLimitBackoffMs = config.rateLimitBackoffMs ?? PERMAPEOPLE.rateLimitBackoffMs;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await applyRequestSpacing(config);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hitsPerPage, q: searchTerm }),
      });
      lastApiCallAt = Date.now();

      if (res.status === 429) {
        if (attempt < retries) {
          await sleep(rateLimitBackoffMs);
          continue;
        }
        return { hits: [], error: 'rate_limited' };
      }

      if (res.status >= 500) {
        if (attempt < retries) {
          await sleep(backoffMs * 2 ** (attempt - 1));
          continue;
        }
        return { hits: [], error: `http_${res.status}` };
      }

      if (res.status >= 400) {
        return { hits: [], error: `http_${res.status}` };
      }

      const data = await res.json();
      if (!data || typeof data !== 'object') {
        return { hits: [], error: 'invalid_json_payload' };
      }
      if (!Array.isArray(data.hits)) {
        return { ...data, hits: [] };
      }
      return data;
    } catch (_err) {
      if (attempt < retries) {
        await sleep(backoffMs * 2 ** (attempt - 1));
        continue;
      }
      return { hits: [], error: 'network_error' };
    }
  }

  return { hits: [], error: 'unknown' };
}

export async function readCache(searchTerm, config = {}) {
  const p = cachePath(searchTerm, config);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(await fsp.readFile(p, 'utf8'));
  } catch {
    // Corrupted cache file (e.g. partial write from interrupted run) — delete and retry from API
    try { await fsp.unlink(p); } catch {}
    return null;
  }
}

export async function writeCache(searchTerm, result, config = {}) {
  const dir = config.cacheDir || PATHS.permapeopleCacheDir;
  const p = cachePath(searchTerm, config);
  await ensureDir(dir);
  const payload = {
    searchTerm,
    cachedAt: new Date().toISOString(),
    result: result || { hits: [] },
  };
  await fsp.writeFile(p, JSON.stringify(payload, null, 2), 'utf8');
  await updateManifest(config);
  return payload;
}

export async function updateManifest(config = {}) {
  const dir = config.cacheDir || PATHS.permapeopleCacheDir;
  const manifestPath = config.manifestPath || PATHS.permapeopleManifest;
  await ensureDir(path.dirname(manifestPath));

  const files = fs.existsSync(dir)
    ? (await fsp.readdir(dir)).filter((n) => n.endsWith('.json'))
    : [];

  const manifest = {
    source: 'permapeople',
    lastQueryDate: new Date().toISOString(),
    totalCachedEntries: files.length,
    cacheHits: runStats.hits,
    cacheMisses: runStats.misses,
  };

  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}

export function getCacheStats() {
  return {
    hits: runStats.hits,
    misses: runStats.misses,
    total: runStats.hits + runStats.misses,
  };
}

let consecutive429s = 0;
const MAX_CONSECUTIVE_429S = 3;

async function searchWithCache(searchTerm, config = {}) {
  if (!searchTerm) return { hits: [] };

  const cached = await readCache(searchTerm, config);
  if (cached) {
    runStats.hits += 1;
    return cached.result;
  }

  // Circuit breaker: abort if we've hit too many consecutive 429s
  if (consecutive429s >= MAX_CONSECUTIVE_429S) {
    const err = new Error(
      `Aborting: ${MAX_CONSECUTIVE_429S} consecutive 429 rate-limit responses from Permapeople API. `
      + 'Re-run the pipeline to resume from where it left off (cached results will be reused).',
    );
    err.code = 'RATE_LIMITED_ABORT';
    throw err;
  }

  runStats.misses += 1;
  const apiResult = await apiSearch(searchTerm, config);

  // Don't cache rate-limited or server error responses — we want to retry on resume
  if (apiResult.error === 'rate_limited' || (apiResult.error && apiResult.error.startsWith('http_5'))) {
    consecutive429s = apiResult.error === 'rate_limited' ? consecutive429s + 1 : consecutive429s;
    return apiResult;
  }

  // Successful response — reset circuit breaker and cache
  consecutive429s = 0;
  await writeCache(searchTerm, apiResult, config);
  return apiResult;
}

export async function searchPlant(scientificName, config = {}) {
  return searchWithCache(scientificName, config);
}

export async function searchPlantByCommonName(commonName, config = {}) {
  return searchWithCache(commonName, config);
}
