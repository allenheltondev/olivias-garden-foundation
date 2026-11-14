import { useEffect } from 'react';
import { PageHero } from '../chrome';
import faqContent from '../faq-content.json';

type FaqItem = {
  id: string;
  question: string;
  answer: string;
  link?: { href: string; label: string };
};

type FaqSection = {
  id: string;
  title: string;
  items: FaqItem[];
};

const sections: FaqSection[] = faqContent.sections;

const FAQ_JSON_LD_ID = 'faq';

function buildFaqJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: sections.flatMap((section) => section.items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    }))),
  };
}

/**
 * Adds FAQPage structured data while the page is mounted. The prerendered
 * /faq HTML carries the same block for crawlers that don't run JS; this keeps
 * it present after client-side navigation and removes it when leaving.
 */
function useFaqStructuredData() {
  useEffect(() => {
    let script = document.head.querySelector(`script[data-seo-id="${FAQ_JSON_LD_ID}"]`) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.type = 'application/ld+json';
      script.dataset.seoId = FAQ_JSON_LD_ID;
      document.head.appendChild(script);
    }
    script.textContent = JSON.stringify(buildFaqJsonLd());

    return () => {
      document.head.querySelector(`script[data-seo-id="${FAQ_JSON_LD_ID}"]`)?.remove();
    };
  }, []);
}

export function FaqPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  useFaqStructuredData();

  return (
    <div className="faq-page">
      <PageHero
        title="Frequently asked questions"
        titleClassName="faq-hero__title"
        body="Answers about free okra seeds, growing okra, donations, and what's open right now. Don't see your question? Send us a note."
      />

      <nav className="faq-toc" aria-label="FAQ topics">
        <ul className="faq-toc__list">
          {sections.map((section) => (
            <li key={section.id}>
              <a className="faq-toc__link" href={`#${section.id}`}>{section.title}</a>
            </li>
          ))}
        </ul>
      </nav>

      {sections.map((section) => (
        <section key={section.id} id={section.id} className="page-section faq-section" aria-labelledby={`${section.id}-heading`}>
          <h2 id={`${section.id}-heading`} className="faq-section__title">{section.title}</h2>
          <div className="faq-section__items">
            {section.items.map((item) => (
              <article key={item.id} id={item.id} className="faq-item">
                <h3 className="faq-item__question">{item.question}</h3>
                <p className="faq-item__answer">{item.answer}</p>
                {item.link ? (
                  <a
                    className="faq-item__link"
                    href={item.link.href}
                    onClick={(event) => {
                      event.preventDefault();
                      onNavigate(item.link!.href);
                    }}
                  >
                    {item.link.label}
                  </a>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
