import type { MouseEvent } from 'react';
import { CtaButton } from '../chrome';

export function NotFoundPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const navigateTo = (path: string) => (event: MouseEvent<HTMLAnchorElement | HTMLButtonElement>) => {
    event.preventDefault();
    onNavigate(path);
  };

  return (
    <section className="not-found-page" aria-labelledby="not-found-title">
      <div className="not-found-page__copy">
        <p className="not-found-page__eyebrow">404</p>
        <h1 id="not-found-title">Page not found</h1>
        <p>
          That link does not point to a page we have. You can head home, open the Okra Project map,
          or use the links below to keep moving.
        </p>
        <div className="not-found-page__actions" aria-label="Helpful links">
          <CtaButton href="/" onClick={navigateTo('/')}>Go home</CtaButton>
          <CtaButton href="/okra" variant="secondary" onClick={navigateTo('/okra')}>Open the Okra map</CtaButton>
        </div>
      </div>
      <nav className="not-found-page__links" aria-label="Popular pages">
        <a href="/about" onClick={navigateTo('/about')}>About Olivia&apos;s Garden</a>
        <a href="/donate" onClick={navigateTo('/donate')}>Donate</a>
        <a href="/contact" onClick={navigateTo('/contact')}>Contact</a>
      </nav>
    </section>
  );
}
