import { Card, FormFeedback, Input, Textarea } from '@olivias/ui';
import { lazy, Suspense, useState, type FormEvent } from 'react';
import type { AuthSession } from '../../auth/session';
import { CtaButton, PageHero, Section, WorkIcon } from '../chrome';
import { buildResponsiveBackgroundImage, ResponsiveImage } from '../responsive-images';
import { facebookUrl, instagramUrl } from '../routes';

const CONTACT_EMAIL = 'allen@oliviasgarden.org';

const OkraExperience = lazy(async () => {
  const module = await import('../../okra/OkraExperience');
  return { default: module.OkraExperience };
});

export function HomePage({ onNavigate }: { onNavigate: (path: string) => void; }) {
  return (
    <>
      <PageHero
        title="Learn to grow food. Learn to keep it going."
        body="Olivia's Garden Foundation is a 501(c)(3) nonprofit in McKinney, Texas helping individuals and families learn how to grow food, care for animals, preserve what they produce, and build practical self-sufficiency."
        className="home-hero"
        titleClassName="home-hero__title"
        backgroundImage={buildResponsiveBackgroundImage('/images/home/garden-landscaping.jpg')}
        actions={(
          <a
            className="home-hero__cta"
            href="https://instagram.com/oliviasgardentx"
            target="_blank"
            rel="noreferrer"
          >
            Get involved
          </a>
        )}
      />

      <section className="home-mission-band" aria-label="Mission">
        <div className="home-mission-band__copy">
          <p className="home-mission-band__eyebrow">Mission</p>
          <h2>Practical food-growing education for families and the wider community.</h2>
          <p>
            We teach through real work on a functioning property in McKinney, then share that work
            in ways that help more people start growing, raising, preserving, and sharing food of
            their own while connecting growers with each other and with people in their communities
            who need fresh food.
          </p>
        </div>
      </section>

      <section className="page-section home-photo-band-section">
        <div className="home-photo-band" aria-label="Life and work at the foundation">
          <ResponsiveImage
            className="home-photo-band__image"
            src="/images/home/melon-harvest.jpg"
            alt="Harvesting in raised beds with a child."
            sizes="(max-width: 900px) 100vw, 33vw"
          />
          <ResponsiveImage
            className="home-photo-band__image"
            src="/images/home/watering-seedlings.jpg"
            alt="Watering seedlings in a raised garden bed."
            sizes="(max-width: 900px) 100vw, 33vw"
          />
          <ResponsiveImage
            className="home-photo-band__image home-photo-band__image--mobile-hide"
            src="/images/home/bee-suit.jpg"
            alt="Working bees with a child in protective gear."
            sizes="33vw"
          />
        </div>
      </section>

      <section className="home-mobile-image-break" aria-label="Life and work at the foundation">
        <ResponsiveImage
          className="home-mobile-image-break__image"
          src="/images/home/melon-harvest.jpg"
          alt="Harvesting in raised beds with a child."
          sizes="100vw"
        />
      </section>

      <Section
        title="What we do"
        intro="We share what we learn from doing the work ourselves and staying close to what  helps people get started."
        className="section-teach"
      >
        <div className="home-teach-grid" aria-label="Core focus areas">
          <div className="home-teach-stack">
            <article className="home-teach-item">
              <div className="home-teach-item__body">
                <div className="home-teach-item__heading">
                  <div className="home-teach-item__icon"><WorkIcon kind="sprout" /></div>
                  <h3>Teach from real work</h3>
                </div>
                <p>If we're sharing it, it's something we're actively doing.</p>
              </div>
            </article>
            <article className="home-teach-item">
              <div className="home-teach-item__body">
                <div className="home-teach-item__heading">
                  <div className="home-teach-item__icon"><WorkIcon kind="tool" /></div>
                  <h3>Make starting feel possible</h3>
                </div>
                <p>This should feel within reach. The goal is to make getting started simpler.</p>
              </div>
            </article>
            <article className="home-teach-item">
              <div className="home-teach-item__body">
                <div className="home-teach-item__heading">
                  <div className="home-teach-item__icon"><WorkIcon kind="post" /></div>
                  <h3>Stay honest about the work</h3>
                </div>
                <p>This is a working place. Some days are messy, and we show that too.</p>
              </div>
            </article>
            <article className="home-teach-item">
              <div className="home-teach-item__body">
                <div className="home-teach-item__heading">
                  <div className="home-teach-item__icon"><WorkIcon kind="hands" /></div>
                  <h3>Share what helps</h3>
                </div>
                <p>The goal isn't just to grow here. It's to help more people start where they are.</p>
              </div>
            </article>
          </div>
        </div>
      </Section>

      <section className="home-mobile-image-break" aria-label="Learning through real work">
        <ResponsiveImage
          className="home-mobile-image-break__image"
          src="/images/home/watering-seedlings.jpg"
          alt="Watering seedlings in a raised garden bed."
          sizes="100vw"
        />
      </section>

      <Section title="Ways to take part" className="section-take-part">
        <div className="home-action-grid">
          <article className="home-editorial-block home-editorial-block--action">
            <h3>Who is Olivia?</h3>
            <p>
              Olivia was a true Texas cowgirl who loved being outside, spending time in the garden, and interacting with animals. Learn more about her.
            </p>
            <CtaButton href="/about" onClick={(event) => {
              event?.preventDefault?.();
              onNavigate('/about');
            }} variant="secondary">Olivia&apos;s story</CtaButton>
          </article>
          <article className="home-editorial-block home-editorial-block--action">
            <h3>Get free okra seeds</h3>
            <p>
              The foundation gives away free okra seeds from a line of plants Olivia grew herself.
              It is meant to be an easy, generous way for people to start growing food.
            </p>
            <CtaButton href="/okra" onClick={(event) => {
              event?.preventDefault?.();
              onNavigate('/okra');
            }} variant="secondary">Request your seeds</CtaButton>
          </article>
          <article className="home-editorial-block home-editorial-block--action">
            <h3>Support the work</h3>
            <p>
              You can directly support the garden,
              animals, tools, and community-facing programs to keep growing.
            </p>
            <CtaButton href="/donate" onClick={(event) => {
              event?.preventDefault?.();
              onNavigate('/donate');
            }} variant="secondary">Donate</CtaButton>
          </article>
          <article className="home-editorial-block home-editorial-block--action">
            <h3>Follow along</h3>
            <p>
              Instagram is the best place to see what is growing, what is being built, and what the
              day-to-day work actually looks like.
            </p>
            <a
              className="home-action-link home-action-link--secondary"
              href="https://instagram.com/oliviasgardentx"
              target="_blank"
              rel="noreferrer"
            >
              Follow us
            </a>
          </article>
        </div>
      </Section>
    </>
  );
}

export function AboutPage() {
  return (
    <div className="about-prose-page">
      <section className="about-prose-hero" aria-label="About Olivia's Garden">
        <div className="about-prose-hero__copy">
          <div className="about-prose-hero__header">
            <p className="about-prose-hero__eyebrow">In Olivia&apos;s memory</p>
            <h1>About Olivia&apos;s Garden</h1>
            <p className="about-prose-hero__dek">
              The story behind the foundation, the family, and the work being built in Olivia&apos;s memory.
            </p>
          </div>
          <div className="about-prose-hero__story">
            <p>
            Olivia used to pull things off plants and eat them raw, right there in the garden.
            Dragon&apos;s tongue green beans. Borage flowers. Colossus marigold heads. She&apos;d pop
            them into her mouth in front of company like it was a magic trick, this big grin,
            totally pleased with herself. She thought it was the coolest thing in the world that
            you could grow something and eat it before you even made it back inside.
            </p>
            <p>
            She loved okra most of all. Straight off the plant. That is still how we eat it.
            </p>
            <p>
            She was four years old. Tough as nails. An absolute cowgirl. She herded the goats and
            fed the chickens and wanted to be part of whatever was happening on the land. She and
            her dad Allen used to walk the property together and throw out ideas about what they
            would plant, what they would build someday. Nothing finished. Just ideas tossed into
            the air between them.
            </p>
            <p>
            She was diagnosed with AML in 2023. Acute myeloid leukemia. We fought it for seven and
            a half months. Children&apos;s Medical Center in Plano was our home base. We also traveled
            to St. Jude in Memphis, Nationwide Children&apos;s in Columbus, and Seattle Children&apos;s
            Hospital. We were preparing for a bone marrow transplant when she passed.
            </p>
          </div>
        </div>

        <figure className="photo-card photo-card--tall about-prose-hero__image">
          <ResponsiveImage
            src="/images/home/sunset-garden.jpg"
            alt="Sunset over the garden beds at Olivia's Garden."
            sizes="(max-width: 900px) 100vw, 42vw"
          />
          <figcaption>The land where her memory keeps taking shape.</figcaption>
        </figure>
      </section>

      <hr className="about-divider" />

      <section className="about-prose-block about-prose-block--origin" aria-label="How the foundation began">
        <p className="about-prose-block__eyebrow">How it began</p>
        <p>
          After Olivia passed, Allen and Mallory wanted to build something in her memory. They had
          seen up close what families in treatment go through. The logistics are relentless. Access
          to fresh, local food is harder than it should be. The first idea was straightforward:
          start a foundation to grow and provide locally available food to families who needed it
          most.
        </p>
        <p>
          Then they started building the garden. And as they built, they kept coming back to
          Olivia. How much she loved being out here. How naturally she took to it. How the things
          she was learning at four years old were the kind of things most people never learn at
          all. The mission grew from there. Not just food. Skills. The kind that stay with a
          person, that make a family more capable and more self-reliant. Teach someone to grow food
          and you have changed what they are capable of for the rest of their lives.
        </p>
      </section>

      <hr className="about-divider" />

      <section className="about-memory-layout" aria-label="Building the garden">
        <div className="about-prose-block">
          <p className="about-prose-block__eyebrow">Building the garden</p>
          <p>
            Allen sat down and designed the garden she always wanted.
          </p>
          <p>
            He pulled in everything they had talked about on those walks. Her ideas, her favorite
            things to grow, the way she moved through the land. Then they built it. Six raised beds
            became a quarter-acre memorial garden. Volunteers showed up. The community showed up.
            Their daughter Isabella helped however she could.
          </p>
          <p>
            It was a hard year. Building was the channel for grief, the thing that made it possible
            to get through each day. And watching the community pour in made something clear that
            they already suspected: teaching people to grow things, raise things, care for a piece
            of land was the right thing to build toward.
          </p>
          <p>
            The Colossus marigolds go in every season. Olivia&apos;s favorite. They always will.
          </p>
        </div>

        <figure className="photo-card about-memory-layout__image">
          <ResponsiveImage
            src="/images/about/luffa-trellis.jpg"
            alt="Garden rows and trellised plants at Olivia's Garden."
            sizes="(max-width: 900px) 100vw, 42vw"
          />
          <figcaption>Built by hand, in memory, with the community alongside us.</figcaption>
        </figure>
      </section>

      <hr className="about-divider" />

      <section className="about-prose-block about-prose-block--closing" aria-label="Who runs the foundation">
        <p className="about-prose-block__eyebrow">Who runs it</p>
        <p>
          Olivia&apos;s Garden Foundation is run by the Helton family. Allen, Mallory, and Isabella,
          out of McKinney, Texas.
        </p>
        <p>
          We are not experts. We are a family who loves a little girl who loved this land, and we
          are doing our best to honor that by sharing what we know and building something useful for
          other people.
        </p>
        <p>
          If you are going through what we went through, AML or any childhood cancer, and you want
          to talk to someone who has been there, we are here for that too.
        </p>
        <p>
          We are still learning. We are building in public. And we are glad you found us.
        </p>
      </section>
    </div>
  );
}

export function GetInvolvedPage({ onNavigate }: { onNavigate: (path: string) => void; }) {
  return (
    <>
      <PageHero
        eyebrow="Get Involved"
        title="Get involved"
        body="There are a few clear ways to be part of the work here now, and a few more that are being built honestly instead of rushed."
      />

      <div className="stack-grid get-involved-grid">
        <Card title="Start with seeds. Literally." className="get-involved-card">
          <p className="get-involved-card__eyebrow">Easiest first step</p>
          <p>
            The easiest way into this is okra. It&apos;s one of the most forgiving plants you can grow.
            It tolerates heat, bounces back from neglect, and produces more than you expect.
          </p>
          <CtaButton href="/okra" onClick={(event) => {
            event?.preventDefault?.();
            onNavigate('/okra');
          }}>Request your free okra seeds</CtaButton>
        </Card>

        <Card title="Come work the land." className="get-involved-card">
          <p className="get-involved-card__eyebrow">In person</p>
          <p>
            We run regular work days tied to garden prep, animal care, event setup,
            whatever needs doing that week. It&apos;s real work and you&apos;ll go home tired.
          </p>
          <ul className="site-list">
            <li>Garden work days and bed prep</li>
            <li>Animal care for chickens, turkeys, geese, goats, bees, and guineas</li>
            <li>Event and workshop support</li>
          </ul>
          <CtaButton href="/contact" onClick={(event) => {
            event?.preventDefault?.();
            onNavigate('/contact');
          }}>Sign up to volunteer</CtaButton>
        </Card>

        <Card title="Hands-on workshops — coming soon." className="get-involved-card">
          <p className="get-involved-card__eyebrow">Coming soon</p>
          <p>
            Workshops are planned, but they are not active yet. When they launch, they will be
            built around real tasks and hands-on learning, not classroom-style theory.
          </p>
          <CtaButton
            variant="secondary"
            href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Notify me when workshops open')}`}
          >
            Notify me when workshops open
          </CtaButton>
        </Card>

        <Card title="Help us map where food is growing." className="get-involved-card">
          <p className="get-involved-card__eyebrow">Online</p>
          <p>
            The Okra Project is a living map of people growing food. If you&apos;re growing food
            anywhere, add your pin. Every garden on the map makes the case that this is normal,
            widespread, and worth doing.
          </p>
          <CtaButton href="/okra" onClick={(event) => {
            event?.preventDefault?.();
            onNavigate('/okra');
          }}>View the Okra Project map</CtaButton>
        </Card>
      </div>

      <Section
        title="Follow along."
        body="We post what is actually happening in the work: harvests, setbacks, animals, systems, and the day-to-day reality of learning by doing."
      >
        <CtaButton variant="secondary" href={instagramUrl}>Follow us on Instagram</CtaButton>
      </Section>

      <Section
        title="Something else in mind?"
        body="Press, partnerships, speaking requests, or something we haven't thought of yet — send a note and we'll figure it out together."
      >
        <CtaButton
          variant="secondary"
          href="/contact"
          onClick={(event) => {
            event?.preventDefault?.();
            onNavigate('/contact');
          }}
        >
          Get in touch
        </CtaButton>
      </Section>
    </>
  );
}

export function AuthCallbackPage() {
  return (
    <PageHero
      eyebrow="Sign in"
      title="Sign in from the login page"
      body="This route was kept so older auth links do not break, but the site now uses a custom sign-in form on the login page."
    />
  );
}

export function OkraPage({
  onNavigate,
  authEnabled,
  authSession,
  onLogin,
  onSignup,
}: {
  onNavigate: (path: string) => void;
  authEnabled: boolean;
  authSession: AuthSession | null;
  onLogin: () => void;
  onSignup: () => void;
}) {
  return (
    <Suspense fallback={<div className="page-section"><p className="page-text">Loading the Okra Project map...</p></div>}>
      <OkraExperience
        onNavigate={onNavigate}
        authEnabled={authEnabled}
        authSession={authSession}
        onLogin={onLogin}
        onSignup={onSignup}
      />
    </Suspense>
  );
}

export function ImpactPage({ onNavigate }: { onNavigate: (path: string) => void; }) {
  return (
    <>
      <PageHero
        eyebrow="Impact"
        title="What exists now and what is coming next."
        body="The foundation is already doing real work, and some parts of the public-facing program are still being built."
        aside={(
          <div className="page-photo">
            <ResponsiveImage
              src="/images/home/produce-basket.jpg"
              alt="Basket of harvested produce from the garden."
              sizes="(max-width: 900px) 100vw, 28rem"
            />
          </div>
        )}
      />

      <Section
        title="What's already growing."
        body="The work is active and productive."
      >
        <p className="page-kicker">This is not a concept page. The work is already happening.</p>
        <p className="page-text">
          On the land right now: productive garden beds, flowers, chickens, turkeys, geese, goats,
          bees, and guineas. A small Texas vineyard. A pond we use to observe and teach about
          micro-ecosystems.
        </p>
        <p className="page-text">
          Seasonal crops across the full range -- carrots, beets, broccoli, cauliflower, eggplant,
          tomatoes, peppers, onions, artichokes, beans, zucchini, cucumbers. Borage, zinnias,
          cosmos, day lilies, forget-me-nots, and Colossus marigolds from border to border.
        </p>
      </Section>

      <Section
        title="Where we're going."
        body="Next comes a fuller public program: workshops, stronger seed sharing through the Okra Project, and more structured ways to share what the foundation grows with the community."
      >
        <CtaButton href="/get-involved" onClick={(event) => {
          event?.preventDefault?.();
          onNavigate('/get-involved');
        }}>Get involved</CtaButton>
      </Section>

      <Section
        title="See it as it happens."
        body="The best way to understand the foundation is to see the work as it happens: what is growing, what is getting built, what worked, and what had to be adjusted."
      >
        <CtaButton variant="secondary">Follow on Instagram</CtaButton>
      </Section>
    </>
  );
}

export function ContactPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [referral, setReferral] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const canSend = message.trim().length > 0;

  const clearFeedback = () => {
    if (feedback) {
      setFeedback(null);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSend) {
      setFeedback({
        type: 'error',
        message: 'Add a message before opening your email app.',
      });
      return;
    }

    const subject = name.trim()
      ? `Message from ${name.trim()} via oliviasgarden.org`
      : 'Message from oliviasgarden.org';

    const bodyLines = [
      message.trim(),
      '',
      '—',
      name.trim() ? `From: ${name.trim()}` : null,
      email.trim() ? `Reply to: ${email.trim()}` : null,
      referral.trim() ? `Heard about us via: ${referral.trim()}` : null,
    ].filter(Boolean);

    const href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyLines.join('\n'))}`;
    setFeedback({
      type: 'success',
      message: `Your email app should open with this note pre-filled. If it does not, email ${CONTACT_EMAIL} directly.`,
    });
    window.location.href = href;
  };

  return (
    <>
      <PageHero
        eyebrow="Contact"
        title="Get in touch"
        body="We're a real family running a real garden. Seeds, volunteering, partnerships, or just a note — we actually read everything that comes in."
      />

      <div className="contact-grid">
        <Card title="Reach us directly" className="contact-card">
          <p className="contact-card__eyebrow">Quickest way</p>
          <p>
            Email is the fastest path to us. If you're sharing photos of your garden or a long
            story, it's also the easiest format for us to reply to carefully.
          </p>
          <p className="contact-meta">
            Email:{' '}
            <a className="contact-meta__link" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
          </p>
          <ul className="site-list contact-card__list">
            <li>
              <a href={instagramUrl} target="_blank" rel="noreferrer">Instagram</a> — day-to-day work, harvests, animals
            </li>
            <li>
              <a href={facebookUrl} target="_blank" rel="noreferrer">Facebook</a> — events and community posts
            </li>
          </ul>
          <p className="page-text">
            We try to respond within a few days. If it has been longer than that, a second note
            is welcome — things occasionally slip during busy weeks on the land.
          </p>
        </Card>

        <Card title="Send a message" className="contact-card">
          <p className="contact-card__eyebrow">Prefer a form</p>
          <p className="page-text">
            This opens your email app with your message pre-filled so you can send it from your
            own inbox — easier for us to reply to you directly.
          </p>
          <form className="contact-form" onSubmit={handleSubmit} noValidate>
            <Input
              label="Name"
              placeholder="Your name"
              value={name}
              onChange={(event) => {
                clearFeedback();
                setName(event.target.value);
              }}
              autoComplete="name"
            />
            <Input
              type="email"
              label="Email"
              placeholder="Your email"
              value={email}
              onChange={(event) => {
                clearFeedback();
                setEmail(event.target.value);
              }}
              autoComplete="email"
            />
            <Textarea
              label="Message"
              rows={6}
              placeholder="How can we help?"
              value={message}
              onChange={(event) => {
                clearFeedback();
                setMessage(event.target.value);
              }}
              required
            />
            <Input
              label="How did you hear about us? (optional)"
              placeholder="Instagram, friend, work day, etc."
              value={referral}
              onChange={(event) => {
                clearFeedback();
                setReferral(event.target.value);
              }}
            />
            <button
              type="submit"
              className="site-cta og-button og-button--primary og-button--md"
              disabled={!canSend}
            >
              Open email to send
            </button>
            {feedback ? (
              <FormFeedback tone={feedback.type}>{feedback.message}</FormFeedback>
            ) : null}
          </form>
        </Card>
      </div>
    </>
  );
}
