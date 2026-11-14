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

const ONCE_PREFIX = 'ogf:analytics-once:';

/**
 * Sends an event at most once per browser session for a given key, so a page
 * refresh (for example on the donation return URL) doesn't double count.
 */
export function trackEventOnce(onceKey: string, eventName: string, params: AnalyticsParams = {}) {
  const storageKey = `${ONCE_PREFIX}${onceKey}`;
  try {
    if (window.sessionStorage.getItem(storageKey)) {
      return;
    }
    window.sessionStorage.setItem(storageKey, '1');
  } catch {
    // Storage unavailable (private mode, blocked): fall through and send once now.
  }
  trackEvent(eventName, params);
}
