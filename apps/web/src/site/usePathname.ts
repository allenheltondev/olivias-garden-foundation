import { useEffect, useState } from 'react';
import { internalPaths } from './routes';

export function getCurrentPath() {
  if (typeof window === 'undefined') {
    return '/';
  }

  const normalized = window.location.pathname.replace(/\/+$/, '') || '/';
  return internalPaths.has(normalized) ? normalized : '/';
}

export function usePathname() {
  const [pathname, setPathname] = useState(getCurrentPath);

  useEffect(() => {
    const updatePath = () => setPathname(getCurrentPath());

    window.addEventListener('popstate', updatePath);
    return () => window.removeEventListener('popstate', updatePath);
  }, []);

  return {
    pathname,
    navigate(nextPath: string) {
      if (nextPath === pathname) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      window.history.pushState({}, '', nextPath);
      setPathname(nextPath);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  };
}
