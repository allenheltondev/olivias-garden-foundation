const trimmedBase = (import.meta.env.VITE_OKRA_API_BASE ?? '/api').replace(/\/+$/, '');

function randomFallback() {
  return `corr-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function okraApiUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${trimmedBase}${normalizedPath}`;
}

export function createCorrelationId() {
  if (typeof window !== 'undefined' && typeof window.crypto?.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }

  return randomFallback();
}

export function createOkraHeaders(input?: {
  contentType?: string;
  accessToken?: string | null;
  correlationId?: string;
}) {
  const headers = new Headers();

  if (input?.contentType) {
    headers.set('Content-Type', input.contentType);
  }

  headers.set('X-Correlation-Id', input?.correlationId ?? createCorrelationId());

  if (input?.accessToken) {
    headers.set('Authorization', `Bearer ${input.accessToken}`);
  }

  return headers;
}
