// Thin wrapper around GA4 `gtag('event', ...)` for key actions on the site.
//
// The admin app already records *what* happened (donations, seed requests,
// signups). These events exist so GA4 can attribute those outcomes to traffic
// sources and landing pages. Rules:
// - Never send personal data (names, emails, addresses, free text).
// - Analytics is best-effort: a missing or failing gtag must never break a flow.
// - Consent Mode v2 defaults set in index.html still apply to these events.

export type AnalyticsParams = Record<string, string | number | boolean | undefined>;

type GtagEvent = (command: 'event', eventName: string, params?: Record<string, string | number | boolean>) => void;

export function trackEvent(eventName: string, params: AnalyticsParams = {}) {
  if (typeof window === 'undefined') {
    return;
  }

  const gtag = (window as Window & { gtag?: GtagEvent }).gtag;
  if (typeof gtag !== 'function') {
    return;
  }

  const cleaned: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      cleaned[key] = value;
    }
  }

  try {
    gtag('event', eventName, cleaned);
  } catch {
    // Analytics must never interrupt the user's flow.
  }
}

// Once-only records live in localStorage (shared across tabs) so reopening a
// return URL in another tab can't count the same action twice. Entries expire
// and the record is capped so it can't grow without bound.
const ONCE_STORAGE_KEY = 'ogf:analytics-once';
const ONCE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ONCE_MAX_ENTRIES = 50;

function readOnceRecord(now: number): Record<string, number> {
  const raw = window.localStorage.getItem(ONCE_STORAGE_KEY);
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object') return {};
  const fresh: Record<string, number> = {};
  for (const [key, sentAt] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof sentAt === 'number' && now - sentAt < ONCE_TTL_MS) {
      fresh[key] = sentAt;
    }
  }
  return fresh;
}

/**
 * Sends an event at most once per browser for a given key (across tabs and
 * refreshes, within ONCE_TTL_MS), so a donation return URL that is reloaded or
 * reopened doesn't double count.
 */
export function trackEventOnce(onceKey: string, eventName: string, params: AnalyticsParams = {}) {
  try {
    const now = Date.now();
    const record = readOnceRecord(now);
    if (record[onceKey]) {
      return;
    }
    record[onceKey] = now;
    const trimmed = Object.entries(record)
      .sort(([, a], [, b]) => b - a)
      .slice(0, ONCE_MAX_ENTRIES);
    window.localStorage.setItem(ONCE_STORAGE_KEY, JSON.stringify(Object.fromEntries(trimmed)));
  } catch {
    // Storage unavailable (private mode, blocked): fall through and send once now.
  }
  trackEvent(eventName, params);
}
