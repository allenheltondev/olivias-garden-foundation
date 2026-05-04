const color = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m'
};

const symbol = {
  step: `${color.cyan}→${color.reset}`
};

function normalizeBase(url) {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/**
 * Creates an HTTP client bound to a base URL with optional default headers.
 * Every request logs: method, path, response status.
 *
 * @param {string} baseUrl
 * @param {object} [defaultHeaders]
 * @returns {{ request: (path: string, options?: RequestInit) => Promise<{ status: number, headers: Headers, json: any, text: string }> }}
 */
export function createHttpClient(baseUrl, defaultHeaders = {}) {
  const base = normalizeBase(baseUrl);

  async function request(path, options = {}) {
    const method = options.method ?? 'GET';
    console.log(`${symbol.step} ${color.cyan}${method} ${path}${color.reset}`);

    const res = await fetch(`${base}${path}`, {
      ...options,
      headers: { ...defaultHeaders, ...options.headers }
    });

    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }

    console.log(`${color.dim}  status: ${res.status}${color.reset}`);
    return { status: res.status, headers: res.headers, json, text };
  }

  return { request };
}
