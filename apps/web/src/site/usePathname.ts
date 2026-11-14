import { useLocation, useNavigate } from 'react-router-dom';

function normalize(path: string) {
  return path.replace(/\/+$/, '') || '/';
}

const HASH_SCROLL_TIMEOUT_MS = 5000;

/**
 * Scrolls to the element for `hash` once it renders. Client-side navigation
 * doesn't do fragment scrolling, and the target page may be lazy-loaded, so
 * watch the DOM until the element appears (or give up after a few seconds).
 * `previous` is the element with that id on the page we navigated away from,
 * so a same-named id on the old page is never mistaken for the target.
 */
function scrollToHashWhenReady(hash: string, previous: Element | null) {
  const id = decodeURIComponent(hash.replace(/^#/, ''));
  if (!id) {
    return;
  }

  const tryScroll = () => {
    const target = document.getElementById(id);
    if (!target || target === previous) {
      return false;
    }
    target.scrollIntoView({ block: 'start' });
    return true;
  };

  if (tryScroll()) {
    return;
  }

  const observer = new MutationObserver(() => {
    if (tryScroll()) {
      cleanup();
    }
  });
  const timer = window.setTimeout(() => cleanup(), HASH_SCROLL_TIMEOUT_MS);
  function cleanup() {
    observer.disconnect();
    window.clearTimeout(timer);
  }
  observer.observe(document.body, { childList: true, subtree: true });
}

export function usePathname() {
  const location = useLocation();
  const routerNavigate = useNavigate();
  const pathname = normalize(location.pathname);

  return {
    pathname,
    navigate(nextPath: string) {
      const hashIndex = nextPath.indexOf('#');
      if (hashIndex !== -1) {
        const hash = nextPath.slice(hashIndex);
        const samePage = normalize(nextPath.slice(0, hashIndex) || pathname) === pathname;
        const previous = samePage ? null : document.getElementById(decodeURIComponent(hash.slice(1)));
        routerNavigate(nextPath);
        scrollToHashWhenReady(hash, previous);
        return;
      }

      if (nextPath === pathname) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      routerNavigate(nextPath);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  };
}
