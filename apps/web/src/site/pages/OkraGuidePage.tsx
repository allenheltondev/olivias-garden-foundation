import { lazy, Suspense, useEffect, useLayoutEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import type { AuthSession } from '../../auth/session';
import { PageHero } from '../chrome';
import { findOkraGuide, loadOkraGuide, okraGuides, type GuideBlock, type OkraGuide } from '../okra-guides';
import {
  buildGuideJsonLdBlocks,
  guidePath,
  isInternalHref,
  OKRA_HUB_PATH,
  parseInline,
} from '../okra-guides/guide-core.mjs';
import { ZoneLookup } from '../okra-guides/ZoneLookup';
import { ResponsiveImage } from '../responsive-images';
import { siteUrl } from '../routes';
import { ensureStructuredData, removeStructuredData } from '../seo';
import { NotFoundPage } from './NotFoundPage';
import '../../okra/buttons.css';

const SeedRequestModal = lazy(async () => {
  const module = await import('../../okra/components/SeedRequestModal');
  return { default: module.SeedRequestModal };
});

type Navigate = (path: string) => void;

// Every settled state records the slug it belongs to. React Router reuses this
// component across /okra/:slug changes, so state from the previous guide must
// never be shown (or published as JSON-LD) for the next URL.
type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; slug: string; guide: OkraGuide }
  | { status: 'error'; slug: string };

const TOC_MIN_SECTIONS = 3;

function InlineText({ text, onNavigate }: { text: string; onNavigate: Navigate }) {
  return (
    <>
      {parseInline(text).map((token, index) => {
        if (token.type === 'strong') {
          return <strong key={index}>{token.text}</strong>;
        }
        if (token.type === 'link') {
          if (isInternalHref(token.href)) {
            return (
              <a
                key={index}
                href={token.href}
                onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                  event.preventDefault();
                  onNavigate(token.href);
                }}
              >
                {token.text}
              </a>
            );
          }
          const external = token.href.startsWith('https://');
          return (
            <a key={index} href={token.href} rel={external ? 'noopener' : undefined}>
              {token.text}
            </a>
          );
        }
        return <span key={index}>{token.text}</span>;
      })}
    </>
  );
}

/** Image slot widths for the browser to pick a variant: full article width, or
 * the narrower column beside a section's text on wide screens. */
const IMAGE_SIZES_FULL = '(max-width: 900px) 100vw, 48rem';
const IMAGE_SIZES_BESIDE_TEXT = '(min-width: 1100px) 22rem, (max-width: 900px) 100vw, 48rem';

function GuideBlockView({ block, onNavigate, imageSizes = IMAGE_SIZES_FULL }: { block: GuideBlock; onNavigate: Navigate; imageSizes?: string }) {
  switch (block.type) {
    case 'paragraph':
      return <p className="okra-guide__text"><InlineText text={block.text} onNavigate={onNavigate} /></p>;
    case 'list': {
      const items = block.items.map((item, index) => (
        <li key={index}><InlineText text={item} onNavigate={onNavigate} /></li>
      ));
      return block.ordered
        ? <ol className="okra-guide__list">{items}</ol>
        : <ul className="okra-guide__list">{items}</ul>;
    }
    case 'tip':
      return (
        <aside className="okra-guide__tip">
          {block.title ? <p className="okra-guide__tip-title">{block.title}</p> : null}
          <p className="okra-guide__text"><InlineText text={block.text} onNavigate={onNavigate} /></p>
        </aside>
      );
    case 'table':
      return (
        <div className="okra-guide__table-wrap">
          <table className="okra-guide__table">
            {block.caption ? <caption>{block.caption}</caption> : null}
            <thead>
              <tr>
                {block.headers.map((header, index) => (
                  <th key={index} scope="col"><InlineText text={header} onNavigate={onNavigate} /></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}><InlineText text={cell} onNavigate={onNavigate} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'image':
      return (
        <figure className="okra-guide__figure">
          <ResponsiveImage src={block.src} alt={block.alt} sizes={imageSizes} loading="lazy" reserveSpace />
          {block.caption ? (
            <figcaption><InlineText text={block.caption} onNavigate={onNavigate} /></figcaption>
          ) : null}
        </figure>
      );
    case 'zoneLookup':
      return <ZoneLookup block={block} renderText={(text) => <InlineText text={text} onNavigate={onNavigate} />} />;
    default:
      return null;
  }
}

function navigateLink(onNavigate: Navigate, path: string) {
  return {
    href: path,
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      onNavigate(path);
    },
  };
}

/** Distance from the viewport top where the sticky rail rests (5.5rem). */
const RAIL_STICKY_TOP_PX = 88;

/**
 * True when the element fits on screen below its sticky offset. A sticky
 * element taller than the viewport hides its bottom (the seed callout) until
 * the article ends, so taller ones scroll normally instead.
 */
function useFitsViewport(rail: HTMLElement | null) {
  const [fits, setFits] = useState(false);
  useLayoutEffect(() => {
    if (!rail) {
      return undefined;
    }
    const measure = () => setFits(rail.offsetHeight + RAIL_STICKY_TOP_PX + 16 <= window.innerHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(rail);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [rail]);
  return fits;
}

/**
 * The id of the section being read, for highlighting it in the table of
 * contents: the last section whose top has scrolled past the upper third of
 * the screen.
 */
function useActiveSection(ids: string[]) {
  const [active, setActive] = useState<string | null>(null);
  const key = ids.join('|');
  useEffect(() => {
    if (ids.length === 0) {
      return undefined;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = window.innerHeight / 3;
      let current: string | null = null;
      for (const id of ids) {
        const element = document.getElementById(id);
        if (element && element.getBoundingClientRect().top <= line) {
          current = id;
        }
      }
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures ids
  }, [key]);
  return active;
}

/** Page-specific JSON-LD (Article, BreadcrumbList, FAQPage). The prerendered
 * HTML carries the same blocks; this keeps them correct after client-side
 * navigation and removes them when leaving the guide. */
function useGuideStructuredData(guide: OkraGuide | null) {
  // Layout effect: swap the blocks in the same commit that changes the page,
  // so the previous guide's JSON-LD is never paired with the next guide's DOM.
  useLayoutEffect(() => {
    if (!guide) {
      return undefined;
    }
    const blocks = buildGuideJsonLdBlocks(guide, siteUrl);
    blocks.forEach(({ id, data }) => ensureStructuredData(id, data));
    return () => blocks.forEach(({ id }) => removeStructuredData(id));
  }, [guide]);
}

export function OkraGuidePage({
  onNavigate,
  authEnabled,
  authSession,
  onLogin,
  onSignup,
}: {
  onNavigate: Navigate;
  authEnabled: boolean;
  authSession: AuthSession | null;
  onLogin: () => void;
  onSignup: () => void;
}) {
  const { slug } = useParams();
  const summary = findOkraGuide(slug);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [seedModalOpen, setSeedModalOpen] = useState(false);
  const [seedModalRequested, setSeedModalRequested] = useState(false);
  const [railFollowElement, setRailFollowElement] = useState<HTMLElement | null>(null);
  const railFollowFits = useFitsViewport(railFollowElement);

  useEffect(() => {
    if (!summary) {
      return undefined;
    }
    let active = true;
    loadOkraGuide(summary.slug)
      .then((guide) => {
        if (active) setState({ status: 'ready', slug: summary.slug, guide });
      })
      .catch(() => {
        if (active) setState({ status: 'error', slug: summary.slug });
      });
    return () => {
      active = false;
    };
  }, [summary, attempt]);

  // Anything not settled for the current slug (including an unknown slug,
  // where summary is undefined) is treated as loading, never as stale data.
  const current: LoadState = summary && state.status !== 'loading' && state.slug === summary.slug
    ? state
    : { status: 'loading' };
  const guide = current.status === 'ready' ? current.guide : null;
  useGuideStructuredData(guide);
  const tocIds = guide
    ? [
      ...guide.sections.filter((section) => section.placement !== 'aside').map((section) => section.id),
      ...(guide.faq && guide.faq.length > 0 ? ['faq'] : []),
    ]
    : [];
  const activeSection = useActiveSection(tocIds);

  if (!summary) {
    return <NotFoundPage onNavigate={onNavigate} />;
  }

  const openSeedRequest = () => {
    setSeedModalRequested(true);
    setSeedModalOpen(true);
  };

  const related = (guide?.related ?? [])
    .map((relatedSlug) => okraGuides.find((candidate) => candidate.slug === relatedSlug))
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));

  const seedInHero = summary.seedCallToAction === 'hero';

  const renderSection = (section: OkraGuide['sections'][number], className: string) => {
    const isMain = section.placement !== 'aside';
    const figures = section.blocks.filter((block) => block.type === 'image');
    const text = section.blocks.filter((block) => block.type !== 'image');
    // On wide screens a main section's photos sit beside its text rather than
    // breaking it up at full width. Narrow screens stack them below the text.
    if (isMain && figures.length > 0 && text.length > 0) {
      return (
        <section key={section.id} id={section.id} className={`${className} okra-guide__section--with-figure`} aria-labelledby={`${section.id}-heading`}>
          <h2 id={`${section.id}-heading`} className="okra-guide__heading">{section.title}</h2>
          <div className="okra-guide__section-text">
            {text.map((block, index) => <GuideBlockView key={index} block={block} onNavigate={onNavigate} />)}
          </div>
          <div className="okra-guide__section-media">
            {figures.map((block, index) => <GuideBlockView key={index} block={block} onNavigate={onNavigate} imageSizes={IMAGE_SIZES_BESIDE_TEXT} />)}
          </div>
        </section>
      );
    }
    return (
      <section key={section.id} id={section.id} className={className} aria-labelledby={`${section.id}-heading`}>
        <h2 id={`${section.id}-heading`} className="okra-guide__heading">{section.title}</h2>
        {section.blocks.map((block, index) => (
          <GuideBlockView key={index} block={block} onNavigate={onNavigate} />
        ))}
      </section>
    );
  };

  // Main column: the article. Rail (right column on desktop, near the top on
  // phones): the photo, any `"placement": "aside"` sections as cards, the table
  // of contents for long guides, and the seed callout unless it's in the header.
  let main: ReactNode;
  let railCards: ReactNode = null;
  let railToc: ReactNode = null;

  if (current.status === 'error') {
    main = (
      <section className="page-section okra-guide__status" role="alert">
        <p className="page-text">This guide didn&apos;t load. Check your connection and try again.</p>
        <button type="button" className="ok-btn ok-btn--ghost" onClick={() => {
            setState({ status: 'loading' });
            setAttempt((value) => value + 1);
          }}>
          Try again
        </button>
      </section>
    );
  } else if (!guide) {
    main = (
      <section className="page-section okra-guide__status" aria-live="polite">
        <p className="page-text">Loading the guide...</p>
      </section>
    );
  } else {
    const mainSections = guide.sections.filter((section) => section.placement !== 'aside');
    const asideSections = guide.sections.filter((section) => section.placement === 'aside');
    const showToc = mainSections.length >= TOC_MIN_SECTIONS;

    main = (
      <>
        <div className="okra-guide__intro">
          {guide.intro.map((paragraph, index) => (
            <p key={index} className="okra-guide__text okra-guide__lede"><InlineText text={paragraph} onNavigate={onNavigate} /></p>
          ))}
        </div>

        {mainSections.map((section) => renderSection(section, 'okra-guide__section'))}

        {guide.faq && guide.faq.length > 0 ? (
          <section id="faq" className="okra-guide__section" aria-labelledby="faq-heading">
            <h2 id="faq-heading" className="okra-guide__heading">Common questions</h2>
            <div className="faq-section__items">
              {guide.faq.map((item) => (
                <article key={item.question} className="faq-item">
                  <h3 className="faq-item__question">{item.question}</h3>
                  <p className="faq-item__answer"><InlineText text={item.answer} onNavigate={onNavigate} /></p>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </>
    );

    railCards = asideSections.map((section) => renderSection(section, 'okra-guide__rail-card'));
    railToc = (
      <>
        {showToc ? (
          <nav className="okra-guide__toc" aria-label="In this guide">
            <p className="okra-guide__toc-title">In this guide</p>
            <ol className="okra-guide__toc-list">
              {mainSections.map((section) => (
                <li key={section.id}>
                  <a href={`#${section.id}`} aria-current={activeSection === section.id ? 'location' : undefined}>{section.title}</a>
                </li>
              ))}
              {guide.faq && guide.faq.length > 0 ? (
                <li><a href="#faq" aria-current={activeSection === 'faq' ? 'location' : undefined}>Common questions</a></li>
              ) : null}
            </ol>
          </nav>
        ) : null}
      </>
    );
  }

  return (
    <article className="okra-guide">
      <PageHero
        title={summary.title}
        titleClassName="okra-guide__title"
        body={summary.summary}
        actions={seedInHero ? (
          <button type="button" className="ok-btn ok-btn--primary ok-btn--lg" onClick={openSeedRequest}>
            Request free seeds
          </button>
        ) : undefined}
      />

      <div className="okra-guide__layout">
        <aside className="okra-guide__rail" aria-label="About this guide">
          {/* Published guides always have a photo (the validator requires it). Drafts
              may not yet, or may have only its alt text, so check for a real src. */}
          {summary.heroImage?.src?.trim() ? (
            <figure className="page-photo okra-guide__hero-photo">
              <ResponsiveImage
                src={summary.heroImage.src}
                alt={summary.heroImage.alt}
                sizes="(max-width: 959px) 100vw, 22rem"
                reserveSpace
                loading="eager"
                fetchPriority="high"
              />
              {summary.heroImage.caption ? <figcaption>{summary.heroImage.caption}</figcaption> : null}
            </figure>
          ) : null}

          {railCards}

          {/* The contents and seed callout follow the reader down the page on
              wide screens, so the right column isn't empty below the photo. */}
          <div
            ref={setRailFollowElement}
            className={`okra-guide__rail-follow${railFollowFits ? ' okra-guide__rail-follow--sticky' : ''}`}
          >
            {railToc}

            {seedInHero ? null : (
              <div className="okra-guide__seed-cta" role="region" aria-labelledby="okra-guide-seed-cta-heading">
                <h2 id="okra-guide-seed-cta-heading" className="okra-guide__seed-cta-title">Grow Olivia&apos;s okra</h2>
                <p className="okra-guide__text">
                  We mail free Clemson Spineless okra seeds from Olivia&apos;s own seed line to anyone in the
                  United States or Canada.
                </p>
                <button type="button" className="ok-btn ok-btn--primary" onClick={openSeedRequest}>
                  Request free seeds
                </button>
              </div>
            )}
          </div>
        </aside>

        <div className="okra-guide__main">
          {/* No visible reviewer or date line (foundation preference). Dates
              still reach search engines via JSON-LD and the sitemap. Drafts
              are labeled so a preview can't be mistaken for a live page. */}
          {summary.status === 'draft' ? (
            <p className="okra-guide__meta"><strong>Draft: not indexed</strong></p>
          ) : null}

          {main}

          <section className="okra-guide__next" aria-labelledby="okra-guide-next-heading">
            <h2 id="okra-guide-next-heading" className="okra-guide__heading">Keep going</h2>
            <div className="okra-guide__next-actions">
              <button type="button" className="ok-btn ok-btn--primary ok-btn--lg" onClick={openSeedRequest}>
                Request free okra seeds
              </button>
              <a className="ok-btn ok-btn--ghost ok-btn--lg" {...navigateLink(onNavigate, OKRA_HUB_PATH)}>
                See where Olivia&apos;s okra is growing
              </a>
            </div>
            {related.length > 0 ? (
              <nav aria-label="Related okra guides">
                <ul className="okra-guide__related">
                  {related.map((item) => (
                    <li key={item.slug}>
                      <a className="okra-guide__related-link" {...navigateLink(onNavigate, guidePath(item.slug))}>
                        <span className="okra-guide__related-title">{item.title}</span>
                        <span className="okra-guide__related-body">{item.description}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            ) : null}
          </section>
        </div>
      </div>

      {seedModalRequested ? (
        <Suspense fallback={null}>
          <SeedRequestModal
            open={seedModalOpen}
            onClose={() => setSeedModalOpen(false)}
            authEnabled={authEnabled}
            authSession={authSession}
            onLogin={onLogin}
            onSignup={onSignup}
          />
        </Suspense>
      ) : null}
    </article>
  );
}
