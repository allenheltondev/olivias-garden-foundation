import { useLocation, useNavigate } from 'react-router-dom';

function normalize(path: string) {
  return path.replace(/\/+$/, '') || '/';
}

export function usePathname() {
  const location = useLocation();
  const routerNavigate = useNavigate();
  const pathname = normalize(location.pathname);

  return {
    pathname,
    navigate(nextPath: string) {
      if (nextPath === pathname) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      routerNavigate(nextPath);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  };
}
