const trimmedBase = (import.meta.env.VITE_OKRA_API_BASE ?? '/api').replace(/\/+$/, '');

export function okraApiUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${trimmedBase}${normalizedPath}`;
}

