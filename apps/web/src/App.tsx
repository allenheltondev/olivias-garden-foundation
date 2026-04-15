import { type ReactNode, useEffect, useState } from 'react';
import { Button, Card } from '@olivias/ui';
import { OkraExperience } from './okra/OkraExperience';

type Route = {
  path: string;
  label: string;
  showInNav?: boolean;
  showInFooter?: boolean;
  title: string;
  description: string;
};

const routes: Route[] = [
  {
    path: '/',
    label: 'Home',
    showInNav: true,
    showInFooter: true,
    title: "Olivia's Garden Foundation",
    description: 'Practical food-growing education, animal care skills, and community food access.',
  },
  {
    path: '/about',
    label: 'About',
    showInNav: true,
    showInFooter: true,
    title: "About Olivia's Garden",
    description: 'The mission, the family, and the work that supports practical learning.',
  },
  {
    path: '/get-involved',
    label: 'Get Involved',
    title: 'Get involved',
    description: 'Seeds, volunteering, workshops, and ways to participate.',
  },
  {
    path: '/seeds',
    label: 'Request Seeds',
    title: 'Request free okra seeds',
    description: 'Seed distribution entry point for the foundation.',
  },
  {
    path: '/okra',
    label: 'Okra Project',
    showInNav: true,
    showInFooter: true,
    title: 'The Okra Project',
    description: 'Map, seed sharing, and the public growing-food invitation.',
  },
  {
    path: '/impact',
    label: 'Impact',
    title: "What we're building",
    description: 'What is active now and what the foundation is building next.',
  },
  {
    path: '/donate',
    label: 'Donate',
    showInFooter: true,
    title: "Support Olivia's Garden",
    description: 'Donation readiness and direct-support contact path.',
  },
  {
    path: '/contact',
    label: 'Contact',
    showInFooter: true,
    title: 'Get in touch',
    description: 'Direct contact and a simple message form.',
  },
];

const navRoutes = routes.filter((route) => route.showInNav);
const footerRoutes = routes.filter((route) => route.showInFooter);

const internalPaths = new Set(routes.map((route) => route.path));

function getCurrentPath() {
  if (typeof window === 'undefined') {
    return '/';
  }

  const normalized = window.location.pathname.replace(/\/+$/, '') || '/';
  return internalPaths.has(normalized) ? normalized : '/';
}

function usePathname() {
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

function App() {
  const { pathname, navigate } = usePathname();
  const page = routes.find((route) => route.path === pathname) ?? routes[0];

  return (
    <div className="site-shell">
      <SiteHeader pathname={pathname} onNavigate={navigate} />
      <main className="site-main">
        {pathname === '/' ? <HomePage onNavigate={navigate} /> : null}
        {pathname === '/about' ? <AboutPage /> : null}
        {pathname === '/get-involved' ? <GetInvolvedPage onNavigate={navigate} /> : null}
        {pathname === '/okra' ? <OkraPage onNavigate={navigate} /> : null}
        {pathname === '/impact' ? <ImpactPage onNavigate={navigate} /> : null}
        {pathname === '/donate' ? <DonatePage onNavigate={navigate} /> : null}
        {pathname === '/contact' ? <ContactPage /> : null}
        {pathname === '/seeds' ? <SeedsPage onNavigate={navigate} /> : null}
      </main>
      <SiteFooter currentPage={page} onNavigate={navigate} />
    </div>
  );
}

function SiteHeader({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate: (path: string) => void;
}) {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <button className="site-brand" onClick={() => onNavigate('/')}>
          <span className="site-brand__eyebrow">Olivia&apos;s Garden Foundation</span>
          <span className="site-brand__title">Homesteading, growing, and community</span>
        </button>

        <nav className="site-nav" aria-label="Primary">
          {navRoutes.map((route) => (
            <button
              key={route.path}
              className={`site-nav__link ${pathname === route.path ? 'is-active' : ''}`.trim()}
              onClick={() => onNavigate(route.path)}
            >
              {route.label}
            </button>
          ))}
          <button className="site-nav__link site-nav__link--accent" onClick={() => onNavigate('/donate')}>
            Donate
          </button>
        </nav>
      </div>
    </header>
  );
}

function SiteFooter({
  currentPage,
  onNavigate,
}: {
  currentPage: Route;
  onNavigate: (path: string) => void;
}) {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div>
          <p className="site-footer__tagline">
            Growing food, sharing seeds, and helping more people feel at home on the land.
          </p>
          <p className="site-footer__meta">
            {new Date().getFullYear()} Olivia&apos;s Garden Foundation. All rights reserved.
          </p>
        </div>

        <div className="site-footer__links">
          {footerRoutes.map((route) => (
            <button
              key={route.path}
              className={`site-footer__link ${currentPage.path === route.path ? 'is-active' : ''}`.trim()}
              onClick={() => onNavigate(route.path)}
            >
              {route.label}
            </button>
          ))}
        </div>

        <div className="site-footer__social">
          <span>Instagram</span>
          <a href="https://instagram.com/oliviasgardentx" target="_blank" rel="noreferrer">
            @oliviasgardentx
          </a>
        </div>
      </div>
    </footer>
  );
}

function PageHero({
  eyebrow,
  title,
  body,
  aside,
  actions,
  className,
  titleClassName,
  backgroundImage,
}: {
  eyebrow?: string;
  title: string;
  body: string;
  aside?: ReactNode;
  actions?: ReactNode;
  className?: string;
  titleClassName?: string;
  backgroundImage?: string;
}) {
  return (
    <section
      className={`page-hero ${backgroundImage ? 'page-hero--background' : ''} ${className ?? ''}`.trim()}
      style={backgroundImage ? { ['--page-hero-image' as string]: `url(${backgroundImage})` } : undefined}
    >
      <div className={`page-hero__copy ${backgroundImage ? 'page-hero__copy--overlay' : ''}`.trim()}>
        {eyebrow ? <p className="page-eyebrow">{eyebrow}</p> : null}
        <h1 className={titleClassName}>{title}</h1>
        <p className="page-hero__body">{body}</p>
        {actions ? <div className="page-hero__actions">{actions}</div> : null}
      </div>
      {aside ? <div className="page-hero__aside">{aside}</div> : null}
    </section>
  );
}

function Section({
  title,
  body,
  children,
  intro,
  className,
}: {
  title: string;
  body?: string;
  intro?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`page-section ${className ?? ''}`.trim()}>
      <div className="page-section__heading">
        <h2>{title}</h2>
        {intro ? <p className="page-section__intro">{intro}</p> : null}
        {body ? <p className="page-section__body">{body}</p> : null}
      </div>
      {children}
    </section>
  );
}

function CtaButton({
  children,
  onClick,
  variant = 'primary',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary';
}) {
  return (
    <Button className="site-cta" variant={variant} onClick={onClick}>
      {children}
    </Button>
  );
}

function WorkIcon({ kind }: { kind: 'sprout' | 'tool' | 'post' | 'hands' }) {
  const iconByKind = {
    sprout: '/images/icons/trowel.webp',
    tool: '/images/icons/seedling.webp',
    post: '/images/icons/pot.webp',
    hands: '/images/icons/hands.webp',
  } satisfies Record<'sprout' | 'tool' | 'post' | 'hands', string>;

  return <img src={iconByKind[kind]} alt="" aria-hidden="true" className="work-icon" />;
}

function HomePage({ onNavigate }: { onNavigate: (path: string) => void; }) {
  return (
    <>
      <PageHero
        title="Learn to grow food. Learn to keep it going."
        body="Olivia's Garden Foundation is a 501(c)(3) nonprofit in McKinney, Texas helping individuals and families learn how to grow food, care for animals, preserve what they produce, and build practical self-sufficiency."
        className="home-hero"
        titleClassName="home-hero__title"
        backgroundImage="/images/home/garden-landscaping.jpg"
        actions={
          <a
            className="home-hero__cta"
            href="https://instagram.com/oliviasgardentx"
            target="_blank"
            rel="noreferrer"
          >
            Get involved
          </a>
        }
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
          <img
            className="home-photo-band__image"
            src="/images/home/melon-harvest.jpg"
            alt="Harvesting in raised beds with a child."
          />
          <img
            className="home-photo-band__image"
            src="/images/home/watering-seedlings.jpg"
            alt="Watering seedlings in a raised garden bed."
          />
          <img
            className="home-photo-band__image"
            src="/images/home/bee-suit.jpg"
            alt="Working bees with a child in protective gear."
          />

        </div>
      </section>

      <Section
        title="How we do the work"
        intro="What we share comes from doing the work ourselves and staying close to what actually helps people start."
        className="section-teach"
      >
        <div className="home-teach-grid" aria-label="Core focus areas">
          <div className="home-teach-stack">
            <article className="home-teach-item">
              <div className="home-teach-item__icon"><WorkIcon kind="sprout" /></div>
              <div className="home-teach-item__body">
                <h3>Teach from real work</h3>
                <p>If we’re sharing it, it’s something we’re actively doing.</p>
              </div>
            </article>
            <article className="home-teach-item">
              <div className="home-teach-item__icon"><WorkIcon kind="tool" /></div>
              <div className="home-teach-item__body">
                <h3>Make starting feel possible</h3>
                <p>This should feel within reach. The goal is to make getting started simpler.</p>
              </div>
            </article>
            <article className="home-teach-item">
              <div className="home-teach-item__icon"><WorkIcon kind="post" /></div>
              <div className="home-teach-item__body">
                <h3>Stay honest about the work</h3>
                <p>This is a working place. Some days are messy, and we show that too.</p>
              </div>
            </article>
            <article className="home-teach-item">
              <div className="home-teach-item__icon"><WorkIcon kind="hands" /></div>
              <div className="home-teach-item__body">
                <h3>Share what helps</h3>
                <p>The goal isn’t just to grow here. It’s to help more people start where they are.</p>
              </div>
            </article>
          </div>
        </div>
      </Section>

      <Section title="Ways to take part" className="section-take-part">
        <div className="home-action-grid">
          <article className="home-editorial-block home-editorial-block--action">
            <h3>Who is Olivia?</h3>
            <p>
              Olivia was a true Texas cowgirl who loved being outside, spending time in the garden, and interacting with animals. Learn more about her.
            </p>
            <CtaButton onClick={() => onNavigate('/contact')} variant="secondary">Olivia's story</CtaButton>
          </article>
          <article className="home-editorial-block home-editorial-block--action">
            <h3>Get free okra seeds</h3>
            <p>
              The foundation gives away free okra seeds from a line of plants Olivia grew herself.
              It is meant to be an easy, generous way for people to start growing food.
            </p>
            <CtaButton onClick={() => onNavigate('/seeds')} variant="secondary">Request your seeds</CtaButton>
          </article>
          <article className="home-editorial-block home-editorial-block--action">
            <h3>Support the work</h3>
            <p>
              You can directly support the garden,
              animals, tools, and community-facing programs to keep growing.
            </p>
            <CtaButton onClick={() => onNavigate('/donate')} variant="secondary">Donate</CtaButton>
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

function AboutPage() {
  return (
    <div className="about-prose-page">
      <section className="about-prose-hero" aria-label="About Olivia's Garden">
        <div className="about-prose-hero__copy">
          <div className="about-prose-hero__header">
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
          <img
            src="/images/home/sunset-garden.jpg"
            alt="Sunset over the garden beds at Olivia's Garden."
          />
          <figcaption>The land where her memory keeps taking shape.</figcaption>
        </figure>
      </section>

      <hr className="about-divider" />

      <section className="about-prose-block" aria-label="How the foundation began">
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
          <img
            src="/images/about/luffa-trellis.jpg"
            alt="Garden rows and trellised plants at Olivia's Garden."
          />
          <figcaption>Built by hand, in memory, with the community alongside us.</figcaption>
        </figure>
      </section>

      <hr className="about-divider" />

      <section className="about-prose-block about-prose-block--closing" aria-label="Who runs the foundation">
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

function GetInvolvedPage({ onNavigate }: { onNavigate: (path: string) => void; }) {
  return (
    <>
      <PageHero
        eyebrow="Get Involved"
        title="Get involved"
        body="There are a few clear ways to be part of the work here now, and a few more that are being built honestly instead of rushed."
      />

      <div className="stack-grid">
        <Card title="Start with seeds. Literally.">
          <p>
            The easiest way into this is okra. It&apos;s one of the most forgiving plants you can grow.
            It tolerates heat, bounces back from neglect, and produces more than you expect.
          </p>
          <CtaButton onClick={() => onNavigate('/seeds')}>Request your free okra seeds</CtaButton>
        </Card>

        <Card title="Come work the land.">
          <p>
            We run regular work days tied to garden prep, animal care, event setup,
            whatever needs doing that week. It&apos;s real work and you&apos;ll go home tired.
          </p>
          <ul className="site-list">
            <li>Garden work days and bed prep</li>
            <li>Animal care for chickens, turkeys, geese, goats, bees, and guineas</li>
            <li>Event and workshop support</li>
          </ul>
          <CtaButton onClick={() => onNavigate('/contact')}>Sign up to volunteer</CtaButton>
        </Card>

        <Card title="Hands-on workshops -- coming soon.">
          <p>
            Workshops are planned, but they are not active yet. When they launch, they will be
            built around real tasks and hands-on learning, not classroom-style theory.
          </p>
          <CtaButton variant="secondary">Notify me when workshops open</CtaButton>
        </Card>

        <Card title="Help us map where food is growing.">
          <p>
            The Okra Project is a living map of people growing food. If you&apos;re growing food
            anywhere, add your pin. Every garden on the map makes the case that this is normal,
            widespread, and worth doing.
          </p>
          <CtaButton onClick={() => onNavigate('/okra')}>View the Okra Project map</CtaButton>
        </Card>
      </div>

      <Section title="Follow along." body="We post what is actually happening in the work: harvests, setbacks, animals, systems, and the day-to-day reality of learning by doing.">
        <CtaButton variant="secondary">Follow us on Instagram</CtaButton>
      </Section>
    </>
  );
}

function OkraPage({ onNavigate }: { onNavigate: (path: string) => void; }) {
  return <OkraExperience onNavigate={onNavigate} />;
}

function SeedsPage({ onNavigate }: { onNavigate: (path: string) => void; }) {
  return (
    <>
      <PageHero
        eyebrow="Seeds"
        title="Request free okra seeds"
        body="The seed request flow is still being set up, but the program itself is real. The foundation gives away free okra seeds from a line of plants Olivia grew herself."
      />

      <Section
        title="What you get"
        body="Free okra seeds for people in the United States who want to start growing food and take part in the Okra Project."
      >
        <p className="page-text">
          This is meant to be an easy entry point. Start with one crop, get it in the ground, and
          see where it leads. When it grows, we ask that you send back photos so the project can
          show how that seed line keeps moving through other gardens.
        </p>
        <CtaButton onClick={() => onNavigate('/contact')}>Contact us for seeds</CtaButton>
      </Section>
    </>
  );
}

function ImpactPage({ onNavigate }: { onNavigate: (path: string) => void; }) {
  return (
    <>
      <PageHero
        eyebrow="Impact"
        title="What exists now and what is coming next."
        body="The foundation is already doing real work, and some parts of the public-facing program are still being built."
        aside={
          <div className="page-photo">
            <img
              src="/images/home/produce-basket.jpg"
              alt="Basket of harvested produce from the garden."
            />
          </div>
        }
      />

      <Section
        title="What's already growing."
        body="The work is active and productive."
      >
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
        <CtaButton onClick={() => onNavigate('/get-involved')}>Get involved</CtaButton>
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

function DonatePage({ onNavigate }: { onNavigate: (path: string) => void; }) {
  return (
    <>
      <PageHero
        eyebrow="Donate"
        title="Support Olivia's Garden"
        body="Donations are not live yet, but support will eventually help fund seeds, tools, infrastructure, animals, and the daily work of keeping the foundation useful to the community."
      />

      <Section
        title="Donations are coming soon."
        body="Payment processing is not set up yet. If you want to support the foundation before that is live, reach out directly."
      >
        <p className="page-text">
          Support will go toward seeds, tools, animals, infrastructure, and the practical work of
          keeping the foundation open and useful to the people we want to serve.
        </p>
        <CtaButton onClick={() => onNavigate('/contact')}>Get in touch</CtaButton>
      </Section>
    </>
  );
}

function ContactPage() {
  return (
    <>
      <PageHero eyebrow="Contact" title="Get in touch" body="We'd love to hear from you." />

      <div className="contact-grid">
        <Card title="Reach out directly">
          <p>
            Whether you want seeds, have questions about the Okra Project, want to help with the
            work, or just want to say what you&apos;re growing, reach out.
          </p>
          <p className="page-text">We&apos;re real people and we actually respond.</p>
          <p className="contact-meta">Email: [PLACEHOLDER -- INSERT EMAIL]</p>
        </Card>

        <Card title="Send a message">
          <form className="contact-form">
            <label>
              <span>Name</span>
              <input type="text" placeholder="Your name" />
            </label>
            <label>
              <span>Email</span>
              <input type="email" placeholder="Your email" />
            </label>
            <label>
              <span>Message</span>
              <textarea rows={6} placeholder="How can we help?" />
            </label>
            <label>
              <span>How did you hear about us? (optional)</span>
              <input type="text" placeholder="Instagram, friend, work day, etc." />
            </label>
            <CtaButton>Send message</CtaButton>
          </form>
        </Card>
      </div>
    </>
  );
}

export default App;
