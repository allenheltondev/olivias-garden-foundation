import { lazy, Suspense, useEffect, useLayoutEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import type { AuthSession } from '../../auth/session';
import { PageHero } from '../chrome';
import { findOkraGuide, loadOkraGuide, okraGuides, type GuideBlock, type OkraGuide } from '../okra-guides';
import {
  buildGuideJsonLdBlocks,
  formatGuideDate,
  guidePath,
  isInternalHref,
  OKRA_HUB_PATH,
  parseInline,
} from '../okra-guides/guide-core.mjs';
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

function GuideBlockView({ block, onNavigate }: { block: GuideBlock; onNavigate: Navigate }) {
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
          <ResponsiveImage src={block.src} alt={block.alt} sizes="(max-width: 900px) 100vw, 48rem" loading="lazy" />
          {block.caption ? (
            <figcaption><InlineText text={block.caption} onNavigate={onNavigate} /></figcaption>
          ) : null}
        </figure>
      );
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

  const updatedOn = summary.dateModified ?? summary.datePublished;
  let body: ReactNode;

  if (current.status === 'error') {
    body = (
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
    body = (
      <section className="page-section okra-guide__status" aria-live="polite">
        <p className="page-text">Loading the guide...</p>
      </section>
    );
  } else {
    const showToc = guide.sections.length >= TOC_MIN_SECTIONS;
    body = (
      <>
        <div className="okra-guide__intro">
          {guide.intro.map((paragraph, index) => (
            <p key={index} className="okra-guide__text okra-guide__lede"><InlineText text={paragraph} onNavigate={onNavigate} /></p>
          ))}
        </div>

        {showToc ? (
          <nav className="okra-guide__toc" aria-label="In this guide">
            <p className="okra-guide__toc-title">In this guide</p>
            <ol className="okra-guide__toc-list">
              {guide.sections.map((section) => (
                <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>
              ))}
              {guide.faq && guide.faq.length > 0 ? <li><a href="#faq">Common questions</a></li> : null}
            </ol>
          </nav>
        ) : null}

        {guide.sections.map((section) => (
          <section key={section.id} id={section.id} className="okra-guide__section" aria-labelledby={`${section.id}-heading`}>
            <h2 id={`${section.id}-heading`} className="okra-guide__heading">{section.title}</h2>
            {section.blocks.map((block, index) => (
              <GuideBlockView key={index} block={block} onNavigate={onNavigate} />
            ))}
          </section>
        ))}

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
  }

  return (
    <article className="okra-guide">
      <PageHero
        title={summary.title}
        titleClassName="okra-guide__title"
        body={summary.summary}
        aside={(
          <figure className="page-photo okra-guide__hero-photo">
            <ResponsiveImage
              src={summary.heroImage.src}
              alt={summary.heroImage.alt}
              sizes="(max-width: 900px) 100vw, 28rem"
              loading="eager"
              fetchPriority="high"
            />
            {summary.heroImage.caption ? <figcaption>{summary.heroImage.caption}</figcaption> : null}
          </figure>
        )}
      />

      <p className="okra-guide__meta">
        {guide?.review
          ? <>Reviewed by {guide.review.reviewedBy} &middot; Updated {formatGuideDate(updatedOn)}</>
          : <>Updated {formatGuideDate(updatedOn)}</>}
        {summary.status === 'draft' ? <> &middot; <strong>Draft: not indexed</strong></> : null}
      </p>

      <aside className="okra-guide__seed-cta" aria-labelledby="okra-guide-seed-cta-heading">
        <div>
          <h2 id="okra-guide-seed-cta-heading" className="okra-guide__seed-cta-title">Grow Olivia&apos;s okra</h2>
          <p className="okra-guide__text">
            We mail free Clemson Spineless okra seeds from Olivia&apos;s own seed line to anyone in the
            United States or Canada.
          </p>
        </div>
        <button type="button" className="ok-btn ok-btn--primary" onClick={openSeedRequest}>
          Request free seeds
        </button>
      </aside>

      {body}

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
