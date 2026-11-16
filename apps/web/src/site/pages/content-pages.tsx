import { Button, Card, FormFeedback, GardenIcon, Input, Select, Textarea } from '@olivias/ui';
import { lazy, Suspense, useState, type FormEvent, type MouseEvent } from 'react';
import { plannerSignupPath } from '../../auth/redirect';
import type { AuthSession } from '../../auth/session';
import { trackEvent } from '../../observability/analytics';
import {
  buildCrossAppUrl,
  CtaButton,
  LegalDocument,
  LegalSection,
  LegalTableOfContents,
  PageHero,
  Section,
  WorkIcon,
} from '../chrome';
import { boardMembers, foundationOrganization } from '../organization';
import { NewsletterSignup } from '../components/NewsletterSignup';
import { StatsRow } from '../components/StatsRow';
import { Testimonials } from '../components/Testimonials';
import { buildResponsiveBackgroundImage, ResponsiveImage } from '../responsive-images';
import { facebookUrl, goodRootsNetworkUrl, instagramUrl, webApiBase } from '../routes';

const CONTACT_EMAIL = foundationOrganization.contactEmail;

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
            href="/get-involved"
            onClick={(event) => {
              event.preventDefault();
              onNavigate('/get-involved');
            }}
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
        intro="We share what we learn from doing the work ourselves and staying close to what helps people get started."
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
            <h3>Plan your own garden</h3>
            <p>
              Good Roots is our free online garden planner. Lay out your beds, pick what to plant,
              and get watering and harvest reminders, right in your browser.
            </p>
            <CtaButton href="/good-roots" onClick={(event) => {
              event?.preventDefault?.();
              trackEvent('planner_promo_click', { location: 'home' });
              onNavigate('/good-roots');
            }} variant="secondary">Try the planner</CtaButton>
          </article>
        </div>
      </Section>

      <Testimonials />

      <section className="page-section section-newsletter" aria-label="Newsletter signup">
        <NewsletterSignup source="home" />
      </section>
    </>
  );
}

export function AboutPage() {
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

      <hr className="about-divider" />

      <section className="about-prose-block about-governance" aria-label="Governance" id="governance">
        <p className="about-prose-block__eyebrow">Governance</p>
        <p>
          {foundationOrganization.legalName} is a Texas nonprofit and an IRS-recognized 501(c)(3)
          public charity (EIN {foundationOrganization.ein}), determined {foundationOrganization.irsDeterminationDate}.
          Our governing documents, conflict-of-interest policy, and most recent financial filings are
          available on request at{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
        {boardMembers.length > 0 ? (
          <ul className="about-governance__board">
            {boardMembers.map((member) => (
              <li className="about-governance__member" key={member.name}>
                <p className="about-governance__member-name">{member.name}</p>
                <p className="about-governance__member-role">{member.role}</p>
                {member.bio ? <p className="about-governance__member-bio">{member.bio}</p> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

    </div>
  );
}

export function GetInvolvedPage({ onNavigate }: { onNavigate: (path: string) => void; }) {
  return (
    <>
      <PageHero
        title="Get involved"
        body="There are a few clear ways to be part of the work here now, and a few more that are being built honestly instead of rushed."
      />

      <div className="stack-grid get-involved-grid">
        <Card className="get-involved-card">
          <div className="get-involved-card__top"><GardenIcon name="seeds" /><span className="participation-status">Available now</span></div>
          <h2>Start with seeds. Literally.</h2>
          <p>
            The easiest way into this is okra. It&apos;s one of the most forgiving plants you can grow.
            It tolerates heat, bounces back from neglect, and produces more than you expect.
          </p>
          <CtaButton href="/okra" onClick={(event) => {
            event?.preventDefault?.();
            onNavigate('/okra');
          }}>Request your free okra seeds</CtaButton>
        </Card>

        <Card className="get-involved-card">
          <div className="get-involved-card__top"><GardenIcon name="tools" /><span className="participation-status">Join the interest list</span></div>
          <h2>Want to help in person?</h2>
          <p>
            We aren&apos;t open for visits or volunteer days yet. When we are, the work will be
            real: garden prep, animal care, and whatever else needs doing that week. If
            you&apos;d like to be part of it, let us know and we&apos;ll reach out when the
            gate opens.
          </p>
          <CtaButton variant="secondary" href="/contact" onClick={(event) => {
            event?.preventDefault?.();
            onNavigate('/contact');
          }}>Tell us you&apos;re interested</CtaButton>
        </Card>

        <Card className="get-involved-card">
          <div className="get-involved-card__top"><GardenIcon name="bed" /><span className="participation-status">Browse workshops</span></div>
          <h2>Hands-on workshops.</h2>
          <p>
            Learn through real tasks in the garden, from garden prep to food preservation.
            Browse upcoming sessions, check registration, or share what you&apos;d like to learn.
          </p>
          <CtaButton variant="secondary" href="/workshops" onClick={(event) => {
            event?.preventDefault?.();
            onNavigate('/workshops');
          }}>View workshops</CtaButton>
        </Card>

        <Card className="get-involved-card">
          <div className="get-involved-card__top"><GardenIcon name="map" /><span className="participation-status">Available now</span></div>
          <h2>Help us map where food is growing.</h2>
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
        body="Represent an extension program, school, nonprofit, or local business? We'd love to partner. For press, speaking requests, or anything else, send a note and we'll figure it out together."
      >
        <div className="get-involved-actions">
          <CtaButton
            variant="secondary"
            href="/partners"
            onClick={(event) => {
              event?.preventDefault?.();
              onNavigate('/partners');
            }}
          >
            Partner with us
          </CtaButton>
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
        </div>
      </Section>
    </>
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
        title="By the numbers."
        body="A few signals of the work so far. Live numbers come from the Okra Project map; others are tracked by hand and dated."
      >
        <StatsRow />
      </Section>

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

      {/*
        "A story from the garden" section intentionally omitted: it previously
        rendered an unapproved placeholder family story, which could read as a
        real impact claim to donors and visitors. Reinstate this section only
        with a real, approved grower story and photo (ideally sourced from
        admin-managed content rather than hard-coded copy).
      */}

      <Section
        title="Where we're going."
        body="Down the road comes a fuller public program: stronger seed sharing through the Okra Project, more structured ways to share what the foundation grows with the community, and, once we open the gate, hands-on workshops."
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
        <CtaButton variant="secondary" href={instagramUrl}>Follow on Instagram</CtaButton>
      </Section>
    </>
  );
}

const PRIVACY_SECTIONS = [
  { id: 'who-we-are', title: 'Who we are' },
  { id: 'information-we-collect', title: 'Information we collect' },
  { id: 'how-we-use-information', title: 'How we use information' },
  { id: 'how-we-share-information', title: 'How we share information' },
  { id: 'account-and-sign-in-data', title: 'Account and sign-in data' },
  { id: 'cookies-and-analytics', title: 'Cookies and analytics' },
  { id: 'data-retention', title: 'Data retention' },
  { id: 'childrens-privacy', title: "Children's privacy" },
  { id: 'your-choices', title: 'Your choices' },
  { id: 'security', title: 'Security' },
  { id: 'changes-to-this-policy', title: 'Changes to this policy' },
  { id: 'contact', title: 'Contact' },
];

export function PrivacyPolicyPage() {
  return (
    <LegalDocument
      title="Privacy Policy"
      effectiveDate="April 30, 2026"
      intro={(
        <p>
          This policy explains what information Olivia&apos;s Garden Foundation collects, how we
          use it, and the choices available to people who visit, donate, sign up, or participate in
          our programs and online tools.
        </p>
      )}
    >
      <LegalTableOfContents items={PRIVACY_SECTIONS} />

      <LegalSection id="who-we-are" number={1} title="Who we are">
        <p>
          Olivia&apos;s Garden Foundation is a nonprofit organization based in Texas. We operate
          oliviasgarden.org and related experiences, including account features, donation flows,
          seed request tools, and community applications tied to the foundation&apos;s work.
        </p>
      </LegalSection>

      <LegalSection id="information-we-collect" number={2} title="Information we collect">
        <p>
          We may collect information you provide directly, including your name, email address,
          mailing address, donation details, account profile details, messages you send us, seed
          request submissions, photo submissions, and any other information you choose to provide.
        </p>
        <p>
          We may also collect technical and usage information such as device type, browser
          information, approximate location data, pages viewed, referring pages, and interactions
          with our website or forms. Payment card information is generally processed by our payment
          providers and is not stored directly by us except for limited transaction metadata.
        </p>
      </LegalSection>

      <LegalSection id="how-we-use-information" number={3} title="How we use information">
        <p>
          We use information to operate the website, provide requested services, process donations,
          manage accounts, respond to inquiries, administer programs, improve the user experience,
          protect the platform from misuse, and communicate updates related to the foundation and
          its work.
        </p>
        <p>
          If you opt in to receive updates, we may send occasional emails about foundation news,
          programs, donations, events, or related community opportunities. You can unsubscribe from
          promotional emails at any time.
        </p>
      </LegalSection>

      <LegalSection id="how-we-share-information" number={4} title="How we share information">
        <p>
          We do not sell personal information. We may share information with service providers who
          help us operate the website and foundation operations, including hosting providers,
          authentication providers, analytics providers, payment processors, email platforms, and
          software vendors that support communication, fulfillment, moderation, and administration.
        </p>
        <p>
          We may also disclose information when reasonably necessary to comply with law, protect
          the rights and safety of the foundation or others, investigate abuse or fraud, or in
          connection with a reorganization, merger, or transfer of assets.
        </p>
      </LegalSection>

      <LegalSection id="account-and-sign-in-data" number={5} title="Account and sign-in data">
        <p>
          When you create an account or sign in using services such as Google or, later, Facebook,
          we receive profile and authentication information made available by that provider based
          on your permissions and our configuration. We use that information to authenticate you,
          create or maintain your account, and support access across foundation experiences.
        </p>
      </LegalSection>

      <LegalSection id="cookies-and-analytics" number={6} title="Cookies and analytics">
        <p>
          We use Google Analytics 4 to understand site usage in aggregate. Analytics runs in
          cookieless mode by default through Google Consent Mode v2: storage of analytics and
          advertising identifiers is denied unless you tell us otherwise, and Google receives only
          anonymous, aggregated pings without writing analytics cookies to your device.
        </p>
        <p>
          When you sign in to an account, we use storage that is strictly necessary to keep you
          signed in and remember session preferences. You can further control storage through your
          browser settings, though some signed-in features may not function properly if disabled.
        </p>
      </LegalSection>

      <LegalSection id="data-retention" number={7} title="Data retention">
        <p>
          We retain information for as long as reasonably necessary to operate the website,
          fulfill donations or program obligations, maintain records, resolve disputes, enforce
          our agreements, and comply with legal, tax, accounting, or reporting requirements.
        </p>
      </LegalSection>

      <LegalSection id="childrens-privacy" number={8} title="Children's privacy">
        <p>
          Our website and tools are intended for general audiences and family participation, but
          account creation and donations should be completed by an adult or authorized guardian.
          If you believe a child has provided personal information to us inappropriately, contact
          us so we can review and address the situation.
        </p>
      </LegalSection>

      <LegalSection id="your-choices" number={9} title="Your choices">
        <p>
          You may contact us to request access to, correction of, or deletion of certain personal
          information, subject to legal and operational limits. You may also opt out of
          promotional emails through the unsubscribe link included in those messages.
        </p>
        <p>
          You can delete your account and the personal data associated with it at any time. See
          our <a href="/data">data and account deletion page</a> for step-by-step
          instructions, including how to remove data received from Facebook Login or Google
          Sign-In.
        </p>
      </LegalSection>

      <LegalSection id="security" number={10} title="Security">
        <p>
          We use reasonable administrative, technical, and organizational measures to protect
          information, but no method of transmission or storage is completely secure. You use
          the website and provide information at your own risk.
        </p>
      </LegalSection>

      <LegalSection id="changes-to-this-policy" number={11} title="Changes to this policy">
        <p>
          We may update this Privacy Policy from time to time. When we do, we will post the
          updated version on this page and update the effective date above. Continued use of the
          website after an update means you accept the revised policy.
        </p>
      </LegalSection>

      <LegalSection id="contact" number={12} title="Contact">
        <p>
          Questions about this Privacy Policy can be sent through the contact information
          provided on this website, or by writing to{' '}
          <a href="mailto:allen@oliviasgarden.org">allen@oliviasgarden.org</a>.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}

const DATA_DELETION_SECTIONS = [
  { id: 'who-this-is-for', title: 'Who this page is for' },
  { id: 'delete-from-account', title: 'Delete from inside your account' },
  { id: 'delete-by-email', title: 'Request deletion by email' },
  { id: 'what-gets-deleted', title: 'What gets deleted' },
  { id: 'what-we-keep', title: 'What we keep and why' },
  { id: 'third-party-sign-in', title: 'Third-party sign-in data (Facebook, Google)' },
  { id: 'timing', title: 'How long deletion takes' },
  { id: 'questions', title: 'Questions' },
];

export function DataDeletionPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <LegalDocument
      title="Data and account deletion"
      effectiveDate="April 24, 2026"
      intro={(
        <p>
          How to delete your Olivia&apos;s Garden Foundation account and the personal data
          associated with it, including data received from third-party sign-in providers such as
          Facebook and Google.
        </p>
      )}
    >
      <LegalTableOfContents items={DATA_DELETION_SECTIONS} />

      <LegalSection id="who-this-is-for" number={1} title="Who this page is for">
        <p>
          This page explains how anyone with an Olivia&apos;s Garden Foundation account —
          including accounts created with Facebook Login, Google Sign-In, or an email and password
          — can permanently delete their account and the personal data tied to it. It is provided
          as a standing public reference so people and platforms always have clear instructions.
        </p>
      </LegalSection>

      <LegalSection id="delete-from-account" number={2} title="Delete from inside your account">
        <p>
          The fastest way to delete your account is from your profile page. You must be signed in.
        </p>
        <ol>
          <li>
            Sign in at{' '}
            <a
              href="/login"
              onClick={(event) => {
                event.preventDefault();
                onNavigate('/login');
              }}
            >
              oliviasgarden.org/login
            </a>
            .
          </li>
          <li>
            Open your{' '}
            <a
              href="/profile"
              onClick={(event) => {
                event.preventDefault();
                onNavigate('/profile');
              }}
            >
              profile page
            </a>
            .
          </li>
          <li>Scroll to the <strong>Danger zone</strong> section at the bottom of the page.</li>
          <li>Click <strong>Delete my account</strong>.</li>
          <li>
            Confirm by typing <code>DELETE</code> in the pop-up and choosing{' '}
            <strong>Yes, delete my account</strong>.
          </li>
        </ol>
        <p>
          The deletion happens immediately. You&apos;ll be signed out automatically and your
          Olivia&apos;s Garden profile, avatar, and saved preferences will be removed.
        </p>
      </LegalSection>

      <LegalSection id="delete-by-email" number={3} title="Request deletion by email">
        <p>
          If you can&apos;t sign in — for example, you lost access to the email address or social
          account you signed up with — you can request deletion by emailing us instead.
        </p>
        <ul>
          <li>
            Send a message to{' '}
            <a href="mailto:allen@oliviasgarden.org?subject=Account%20deletion%20request">
              allen@oliviasgarden.org
            </a>{' '}
            with the subject <em>Account deletion request</em>.
          </li>
          <li>
            Include the email address or social sign-in (Facebook, Google) you used to create the
            account so we can match the request to the right record.
          </li>
          <li>
            We&apos;ll confirm the request and complete deletion within 30 days. We may ask a
            verification question before deleting if we can&apos;t confirm your identity from the
            request alone.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="what-gets-deleted" number={4} title="What gets deleted">
        <p>
          When your account is deleted, the following information is permanently removed or
          irreversibly scrubbed from our systems:
        </p>
        <ul>
          <li>Your profile: name, display name, bio, location, timezone, and website.</li>
          <li>Your avatar image and any related processed versions.</li>
          <li>
            Your sign-in record, including any linked social provider identity (for example,
            Facebook or Google).
          </li>
          <li>Your email address and contact details stored on your account.</li>
          <li>Donor name and contact information attached to your donation history.</li>
        </ul>
      </LegalSection>

      <LegalSection id="what-we-keep" number={5} title="What we keep and why">
        <p>
          A small set of records may be retained after account deletion for legal, tax, or
          accounting reasons. In every case, records kept are scrubbed of personal identifiers so
          they can no longer be tied back to you.
        </p>
        <ul>
          <li>
            <strong>Donation records.</strong> Nonprofit and tax reporting requires us to keep a
            record of donations received. We remove your name, email, and dedication notes from
            those records at deletion time, but the anonymized transaction remains in our
            accounting.
          </li>
          <li>
            <strong>Moderation and abuse records.</strong> If there is an active investigation
            into content or abuse on the platform, we may retain the minimum information required
            to resolve it.
          </li>
          <li>
            <strong>System logs and backups.</strong> Routine operational logs and backups that
            include account IDs roll off on normal retention schedules. Personal identifiers are
            not restored if backups are used for recovery.
          </li>
        </ul>
      </LegalSection>

      <LegalSection
        id="third-party-sign-in"
        number={6}
        title="Third-party sign-in data (Facebook, Google)"
      >
        <p>
          If you created an Olivia&apos;s Garden Foundation account using Facebook Login or Google
          Sign-In, we received a limited set of profile information from that provider (such as
          your name and email) to create and authenticate your account. When you delete your
          account, that information is deleted from our systems along with the rest of your
          account.
        </p>
        <p>
          Deleting your Olivia&apos;s Garden account does <strong>not</strong> delete your account
          with Facebook, Google, or any other third-party provider. To remove Olivia&apos;s Garden
          from the apps connected to your Facebook account, visit{' '}
          <a
            href="https://www.facebook.com/settings?tab=business_tools"
            target="_blank"
            rel="noreferrer"
          >
            Facebook&apos;s Business Integrations settings
          </a>{' '}
          and remove Olivia&apos;s Garden from the list of connected apps. Removing the app from
          Facebook revokes Facebook&apos;s ongoing sharing of your profile information with us,
          but it does not itself delete any data we already stored — use one of the methods above
          to delete that data.
        </p>
      </LegalSection>

      <LegalSection id="timing" number={7} title="How long deletion takes">
        <p>
          Account deletions initiated from the profile page take effect immediately. Email-based
          deletion requests are processed within 30 days of our receiving a verified request, and
          usually much sooner.
        </p>
      </LegalSection>

      <LegalSection id="questions" number={8} title="Questions">
        <p>
          If you have questions about data deletion or your privacy, you can reach us at{' '}
          <a href="mailto:allen@oliviasgarden.org">allen@oliviasgarden.org</a> or through our{' '}
          <a
            href="/contact"
            onClick={(event) => {
              event.preventDefault();
              onNavigate('/contact');
            }}
          >
            contact page
          </a>
          . Our full{' '}
          <a
            href="/privacy"
            onClick={(event) => {
              event.preventDefault();
              onNavigate('/privacy');
            }}
          >
            privacy policy
          </a>{' '}
          has more on what we collect and how we use it.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}

const TERMS_SECTIONS = [
  { id: 'acceptance', title: 'Acceptance of terms' },
  { id: 'use-of-site', title: 'Use of the site' },
  { id: 'accounts', title: 'Accounts' },
  { id: 'donations', title: 'Donations and payments' },
  { id: 'user-submissions', title: 'User submissions' },
  { id: 'intellectual-property', title: 'Intellectual property' },
  { id: 'third-party-services', title: 'Third-party services and links' },
  { id: 'disclaimers', title: 'Disclaimers' },
  { id: 'limitation-of-liability', title: 'Limitation of liability' },
  { id: 'indemnification', title: 'Indemnification' },
  { id: 'termination', title: 'Termination' },
  { id: 'governing-law', title: 'Governing law' },
  { id: 'changes', title: 'Changes to these terms' },
  { id: 'contact', title: 'Contact' },
];

export function TermsOfServicePage() {
  return (
    <LegalDocument
      title="Terms of Service"
      effectiveDate="April 23, 2026"
      intro={(
        <p>
          These terms govern access to and use of Olivia&apos;s Garden Foundation websites,
          accounts, donation experiences, and related community tools. Please read them carefully.
        </p>
      )}
    >
      <LegalTableOfContents items={TERMS_SECTIONS} />

      <LegalSection id="acceptance" number={1} title="Acceptance of terms">
        <p>
          By accessing or using this website or any related foundation service, you agree to these
          Terms of Service. If you do not agree, do not use the site or related services.
        </p>
      </LegalSection>

      <LegalSection id="use-of-site" number={2} title="Use of the site">
        <p>
          You may use the site only for lawful purposes and in a way that does not interfere with
          the operation, security, or availability of the website or the rights of others. You
          agree not to misuse accounts, attempt unauthorized access, submit fraudulent
          information, scrape restricted areas, upload malicious content, or use the services in
          violation of applicable law.
        </p>
      </LegalSection>

      <LegalSection id="accounts" number={3} title="Accounts">
        <p>
          If you create an account, you are responsible for maintaining the confidentiality of
          your login credentials and for activity that occurs under your account. You agree to
          provide accurate information and to notify us if you believe your account has been
          compromised.
        </p>
      </LegalSection>

      <LegalSection id="donations" number={4} title="Donations and payments">
        <p>
          Donations, purchases, and other payments made through the site may be processed by
          third-party payment providers. Additional terms from those providers may apply. Except
          where required by law or expressly stated otherwise, donations are generally final and
          non-refundable. See our <a href="/refunds">Refund Policy</a> for one-time donation
          refund windows, Garden Club cancellation terms, and refund request instructions.
        </p>
      </LegalSection>

      <LegalSection id="user-submissions" number={5} title="User submissions">
        <p>
          If you submit photos, messages, profile content, seed requests, or other material, you
          represent that you have the right to provide that content and that it does not violate
          the rights of any other person. You grant Olivia&apos;s Garden Foundation a
          non-exclusive, worldwide, royalty-free license to host, store, reproduce, adapt,
          display, and use that content as needed to operate the site, administer programs,
          highlight community participation, and support the foundation&apos;s mission.
        </p>
        <p>
          We may remove or moderate content at our discretion, including content that is
          unlawful, misleading, abusive, inappropriate, infringing, unsafe, or inconsistent with
          the foundation&apos;s mission.
        </p>
      </LegalSection>

      <LegalSection id="intellectual-property" number={6} title="Intellectual property">
        <p>
          Unless otherwise stated, the website, design, text, graphics, logos, photos, videos,
          and other content provided by Olivia&apos;s Garden Foundation are owned by or licensed
          to the foundation and are protected by applicable intellectual property laws. You may
          not copy, reproduce, distribute, or create derivative works from site content except as
          permitted by law or with prior written permission.
        </p>
      </LegalSection>

      <LegalSection id="third-party-services" number={7} title="Third-party services and links">
        <p>
          The site may link to third-party services or rely on third-party platforms for
          payments, sign-in, analytics, maps, hosting, or communications. We are not responsible
          for the content, policies, or practices of third-party services.
        </p>
      </LegalSection>

      <LegalSection id="disclaimers" number={8} title="Disclaimers">
        <p>
          The website and services are provided on an &quot;as is&quot; and &quot;as
          available&quot; basis without warranties of any kind, whether express or implied, to
          the fullest extent permitted by law. We do not guarantee uninterrupted access,
          error-free operation, or that the site will always be secure or free from harmful
          components.
        </p>
      </LegalSection>

      <LegalSection id="limitation-of-liability" number={9} title="Limitation of liability">
        <p>
          To the fullest extent permitted by law, Olivia&apos;s Garden Foundation and its
          officers, directors, volunteers, employees, and affiliates will not be liable for any
          indirect, incidental, special, consequential, or punitive damages, or for any loss of
          data, profits, goodwill, or business opportunities arising from or related to use of
          the site or services.
        </p>
      </LegalSection>

      <LegalSection id="indemnification" number={10} title="Indemnification">
        <p>
          You agree to indemnify and hold harmless Olivia&apos;s Garden Foundation from claims,
          liabilities, damages, losses, and expenses arising out of your use of the site, your
          submissions, or your violation of these terms or applicable law.
        </p>
      </LegalSection>

      <LegalSection id="termination" number={11} title="Termination">
        <p>
          We may suspend or terminate access to the site or specific features at any time if we
          believe it is necessary to protect the foundation, users, or the public, or to address
          violations of these terms.
        </p>
      </LegalSection>

      <LegalSection id="governing-law" number={12} title="Governing law">
        <p>
          These terms are governed by the laws of the State of Texas, without regard to conflict
          of law principles, except where superseded by applicable federal law.
        </p>
      </LegalSection>

      <LegalSection id="changes" number={13} title="Changes to these terms">
        <p>
          We may update these terms from time to time. The updated version will be posted on
          this page with a revised effective date. Continued use of the site after changes
          become effective means you accept the updated terms.
        </p>
      </LegalSection>

      <LegalSection id="contact" number={14} title="Contact">
        <p>
          Questions about these Terms of Service can be sent through the contact information
          provided on this website, or by writing to{' '}
          <a href="mailto:allen@oliviasgarden.org">allen@oliviasgarden.org</a>.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}

const ORG_TYPE_OPTIONS = [
  { value: 'community-garden', label: 'Community garden' },
  { value: 'school', label: 'School or youth program' },
  { value: 'faith', label: 'Faith community' },
  { value: 'mutual-aid', label: 'Nonprofit or mutual aid' },
  { value: 'food-pantry', label: 'Food pantry or shelter' },
  { value: 'other', label: 'Something else' },
];

interface GoodRootsHeroCopy {
  title: string;
  body: string;
  primary: { label: string; href: string; internal?: boolean };
  secondary?: { label: string; href: string; internal?: boolean };
}

function heroForSession(session: AuthSession | null): GoodRootsHeroCopy {
  if (!session) {
    return {
      title: 'Plan a garden you can actually keep up with.',
      body: 'Good Roots is a free garden planning app that works in your browser and on your phone. It helps you decide what to plant, lay out your beds, and stay on top of watering and harvest all season long. When your garden gives you more than you can use, sharing it with neighbors is built right in.',
      primary: { label: 'Start planning for free', href: plannerSignupPath(), internal: true },
      secondary: { label: 'See how it works', href: '#how-it-works', internal: true },
    };
  }

  const appHref = buildCrossAppUrl(goodRootsNetworkUrl, session);

  return {
    title: 'Plan a garden you can actually keep up with.',
    body: 'Good Roots is a free garden planning app that works in your browser and on your phone. It helps you decide what to plant, lay out your beds, and stay on top of watering and harvest all season long. When your garden gives you more than you can use, sharing it with neighbors is built right in.',
    primary: { label: 'Open your garden planner', href: appHref },
  };
}

function AppScreenshot({
  src,
  alt,
  caption,
  path,
  sizes,
  width,
  height,
  className,
}: {
  src: string;
  alt: string;
  caption?: string;
  path: string;
  sizes: string;
  width: number;
  height: number;
  className?: string;
}) {
  return (
    <figure className={`good-roots-shot${className ? ` ${className}` : ''}`}>
      <div className="good-roots-shot__frame">
        <div className="good-roots-shot__bar" aria-hidden="true">
          <span className="good-roots-shot__dots">
            <span />
            <span />
            <span />
          </span>
          <span className="good-roots-shot__url">grn.oliviasgarden.org{path}</span>
          <span className="good-roots-shot__badge">Sample data</span>
        </div>
        <ResponsiveImage
          className="good-roots-shot__image"
          src={src}
          alt={alt}
          sizes={sizes}
          width={width}
          height={height}
        />
      </div>
      {caption ? <figcaption className="good-roots-shot__caption">{caption}</figcaption> : null}
    </figure>
  );
}

type TierInterestChoice = 'supporter' | 'pro' | 'either';

function TierInterestForm({
  tier = 'either',
  source,
  submitLabel = 'Notify me when paid tiers open',
}: {
  tier?: TierInterestChoice;
  source: string;
  submitLabel?: string;
}) {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const canSubmit = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const clearFeedback = () => {
    if (feedback) setFeedback(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || submitting) return;

    setSubmitting(true);
    setFeedback(null);

    try {
      const response = await fetch(`${webApiBase}/contact`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'tier_interest',
          email: email.trim(),
          tier,
          source,
        }),
      });

      if (!response.ok) {
        throw new Error(`Submission failed (${response.status})`);
      }

      setFeedback({
        type: 'success',
        message: "Thanks. We'll email you the moment paid tiers open up.",
      });
      setEmail('');
    } catch (error) {
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : "We couldn't sign you up. Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="contact-form good-roots-tier-form" onSubmit={handleSubmit} noValidate>
      <Input
        type="email"
        label="Email"
        value={email}
        onChange={(event) => { clearFeedback(); setEmail(event.target.value); }}
        required
        autoComplete="email"
      />
      <Button type="submit" disabled={!canSubmit} loading={submitting}>
        {submitting ? 'Submitting...' : submitLabel}
      </Button>
      {feedback ? <FormFeedback tone={feedback.type}>{feedback.message}</FormFeedback> : null}
    </form>
  );
}

function OrganizationInquiryForm() {
  const [orgName, setOrgName] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [orgType, setOrgType] = useState('food-pantry');
  const [city, setCity] = useState('');
  const [stateValue, setStateValue] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const canSubmit =
    orgName.trim().length > 0 &&
    contactName.trim().length > 0 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    city.trim().length > 0 &&
    stateValue.trim().length > 0;

  const clearFeedback = () => {
    if (feedback) setFeedback(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || submitting) return;

    setSubmitting(true);
    setFeedback(null);

    try {
      const response = await fetch(`${webApiBase}/contact`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'organization_inquiry',
          orgName: orgName.trim(),
          contactName: contactName.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          orgType,
          city: city.trim(),
          state: stateValue.trim(),
          message: message.trim() || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error(`Submission failed (${response.status})`);
      }

      setFeedback({
        type: 'success',
        message: "Thanks. We'll be in touch within a few days to help you get your organization set up in Good Roots.",
      });
      setOrgName('');
      setContactName('');
      setEmail('');
      setPhone('');
      setCity('');
      setStateValue('');
      setMessage('');
    } catch (error) {
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : "We couldn't send your request. Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="contact-form good-roots-org-form" onSubmit={handleSubmit} noValidate>
      <div className="good-roots-org-form__row">
        <Input
          label="Organization name"
          value={orgName}
          onChange={(event) => { clearFeedback(); setOrgName(event.target.value); }}
          required
          autoComplete="organization"
        />
        <Select
          label="Organization type"
          value={orgType}
          onChange={(value) => { clearFeedback(); setOrgType(value); }}
          options={ORG_TYPE_OPTIONS}
          required
        />
      </div>
      <div className="good-roots-org-form__row">
        <Input
          label="Your name"
          value={contactName}
          onChange={(event) => { clearFeedback(); setContactName(event.target.value); }}
          required
          autoComplete="name"
        />
        <Input
          type="email"
          label="Email"
          value={email}
          onChange={(event) => { clearFeedback(); setEmail(event.target.value); }}
          required
          autoComplete="email"
        />
      </div>
      <div className="good-roots-org-form__row">
        <Input
          label="Phone (optional)"
          value={phone}
          onChange={(event) => { clearFeedback(); setPhone(event.target.value); }}
          autoComplete="tel"
        />
        <Input
          label="City"
          value={city}
          onChange={(event) => { clearFeedback(); setCity(event.target.value); }}
          required
          autoComplete="address-level2"
        />
        <Input
          label="State"
          value={stateValue}
          onChange={(event) => { clearFeedback(); setStateValue(event.target.value); }}
          required
          autoComplete="address-level1"
        />
      </div>
      <Textarea
        label="Tell us about the people you serve"
        rows={5}
        value={message}
        onChange={(event) => { clearFeedback(); setMessage(event.target.value); }}
      />
      <Button type="submit" disabled={!canSubmit} loading={submitting}>
        {submitting ? 'Sending...' : 'Apply for organization access'}
      </Button>
      {feedback ? <FormFeedback tone={feedback.type}>{feedback.message}</FormFeedback> : null}
    </form>
  );
}

export function GoodRootsPage({
  authSession,
  onNavigate,
}: {
  authSession: AuthSession | null;
  onNavigate: (path: string) => void;
}) {
  const hero = heroForSession(authSession);
  const tier = authSession?.user.tier ?? null;
  const signupPath = plannerSignupPath();
  const appHref = authSession ? buildCrossAppUrl(goodRootsNetworkUrl, authSession) : null;
  // Every planner CTA on this page reports where it sat, so GA4 can show which
  // part of the page actually moves people into the planner.
  const trackPlannerCta = (location: string) => {
    trackEvent('planner_cta_click', { location, signed_in: Boolean(authSession) });
  };
  const handleInternalClick = (href: string, ctaLocation?: string) => (
    event: MouseEvent<HTMLAnchorElement | HTMLButtonElement>,
  ) => {
    event.preventDefault();
    if (ctaLocation) trackPlannerCta(ctaLocation);
    if (href.startsWith('#')) {
      const target = document.querySelector(href);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }
    onNavigate(href);
  };

  return (
    <div className="good-roots-page">
      <PageHero
        className="good-roots-hero"
        titleClassName="good-roots-hero__title"
        title={hero.title}
        body={hero.body}
        aside={(
          <figure className="good-roots-product-preview">
            <div className="good-roots-product-preview__bar"><span>Good Roots Garden Planner</span><span>Sample garden</span></div>
            <ResponsiveImage
              src="/images/good-roots/app-garden-map.jpg"
              width="1616"
              height="1212"
              alt="Good Roots garden designer showing vegetable beds laid out across a garden."
              sizes="(min-width: 1200px) 26rem, (min-width: 760px) 36vw, calc(100vw - 2rem)"
              loading="eager"
              fetchPriority="high"
            />
            <figcaption>Drag your beds into place, right in the browser. Nothing to download or print.</figcaption>
          </figure>
        )}
        actions={(
          <>
            <CtaButton
              href={hero.primary.href}
              onClick={hero.primary.internal
                ? handleInternalClick(hero.primary.href, 'hero')
                : () => trackPlannerCta('hero')}
            >
              {hero.primary.label}
            </CtaButton>
            {hero.secondary ? (
              <CtaButton
                variant="secondary"
                href={hero.secondary.href}
                onClick={hero.secondary.internal ? handleInternalClick(hero.secondary.href) : undefined}
              >
                {hero.secondary.label}
              </CtaButton>
            ) : null}
          </>
        )}
      />

      <section className="home-mission-band good-roots-mission" aria-label="Mission">
        <div className="home-mission-band__copy">
          <p className="home-mission-band__eyebrow">What it is</p>
          <h2>Everything you need to plan and grow a better garden.</h2>
          <p>
            Good Roots gives you one place to plan each season, design your beds, track what
            you've planted, and get reminders so nothing slips through the cracks. Because it's built
            around real gardens run by real people near you, you can see what grows well in your area and
            carry those lessons into next year. And when a crop comes in heavy, passing the extra along to
            a neighbor is right there whenever you want it.
          </p>
        </div>
      </section>

      <Section id="how-it-works" title="How it works" intro="From an empty bed to a season you can actually keep up with.">
        <div className="good-roots-steps">
          <article className="good-roots-step">
            <span className="good-roots-step__number">01</span>
            <h3>Set up your garden</h3>
            <p>Tell us where you garden and add the beds you're working with this season.</p>
          </article>
          <article className="good-roots-step">
            <span className="good-roots-step__number">02</span>
            <h3>Plan what to plant</h3>
            <p>Build a season plan with crops suited to your space, and see what grows well nearby.</p>
          </article>
          <article className="good-roots-step">
            <span className="good-roots-step__number">03</span>
            <h3>Stay on track</h3>
            <p>Get watering, fertilizer, and harvest reminders so the day-to-day never piles up.</p>
          </article>
          <article className="good-roots-step">
            <span className="good-roots-step__number">04</span>
            <h3>Share the extra</h3>
            <p>When a crop comes in heavy, offer the surplus to neighbors who can use it.</p>
          </article>
        </div>
      </Section>

      <section className="page-section good-roots-personas">
        <div className="good-roots-persona">
          <AppScreenshot
            className="good-roots-persona__media"
            src="/images/good-roots/app-garden-map.jpg"
            alt="The Good Roots garden map showing raised beds for tomatoes, peppers, salad greens, beans, herbs, and squash laid out on a lawn."
            caption="Your beds, laid out the way they really sit in the yard."
            path="/garden"
            sizes="(min-width: 960px) 34rem, 100vw"
            width={1616}
            height={1212}
          />
          <div className="good-roots-persona__copy">
            <p className="page-eyebrow">Plan your season</p>
            <h2>Know what to plant, and where.</h2>
            <p>
              Most gardens start with good intentions and a pile of seed packets. Good Roots helps
              you turn that into an actual plan: pick crops that fit your space and your climate, lay
              them out bed by bed, and keep track of everything from "thinking about it" to "in the ground."
            </p>
            <ul className="site-list">
              <li>Season planner with what-to-plant-when</li>
              <li>Bed-by-bed garden designer</li>
              <li>A plant library that tracks every crop's status</li>
              <li>Local planting context so you can see what does well nearby</li>
            </ul>
          </div>
        </div>

        <div className="good-roots-persona good-roots-persona--reverse">
          <AppScreenshot
            className="good-roots-persona__media"
            src="/images/good-roots/app-today.jpg"
            alt="The Today view in Good Roots with a late-spring season summary, crops that are good to plant now, and reminders to water tomatoes, feed peppers, and harvest lettuce."
            caption="Open the app and see exactly what your garden needs today."
            path="/"
            sizes="(min-width: 960px) 34rem, 100vw"
            width={1600}
            height={1200}
          />
          <div className="good-roots-persona__copy">
            <p className="page-eyebrow">Keep it going</p>
            <h2>Stay on top of the day-to-day.</h2>
            <p>
              A garden is a hundred small tasks spread across a season. Good Roots keeps them
              from slipping: reminders for the things that matter, a journal for what you've harvested and
              learned, and a simple daily view of what needs doing. And if you end up with more than you
              need, sharing it with a neighbor is only a tap away.
            </p>
            <ul className="site-list">
              <li>Watering, fertilizer, and harvest reminders</li>
              <li>A garden journal for harvests and notes</li>
              <li>A daily view of what needs doing today</li>
              <li>Share surplus with neighbors whenever you have extra</li>
            </ul>
          </div>
        </div>
      </section>

      <Section
        title="Learn from the gardens around you."
        intro="Every garden in the network adds to a living picture of what people nearby are planting and how it's doing. Use it to choose crops that thrive in your area, time your plantings with the seasons, and — when you want to — see where your extra harvest could do the most good."
        className="good-roots-map-section"
      >
        <AppScreenshot
          className="good-roots-map-shot"
          src="/images/good-roots/app-local-context.jpg"
          alt="Example of local planting context in Good Roots, shown with sample data: guidance that neighbors nearby are asking for tomatoes and okra while zucchini is plentiful, with lists of crops to consider planting and crops already covered."
          caption="Illustrative example with sample data. In the app, this guidance is built from what gardens near you are actually growing and what neighbors are asking for."
          path="/garden/plan/recommendations"
          sizes="(min-width: 1200px) 72rem, 100vw"
          width={1920}
          height={653}
        />
        <div className="good-roots-map-cta">
          {appHref ? (
            <CtaButton href={appHref} onClick={() => trackPlannerCta('local_context')}>
              See what grows near you
            </CtaButton>
          ) : (
            <CtaButton href={signupPath} onClick={handleInternalClick(signupPath, 'local_context')}>
              Start your free garden plan
            </CtaButton>
          )}
          <p>Free for home gardeners. Works in your browser and on your phone, with nothing to download. Set up your first bed in a few minutes.</p>
        </div>
      </Section>

      <Section id="tiers" title="Pick the plot that fits you." intro="Free is live today. Supporter and Pro tiers are on the way. Leave your email and we'll tell you the moment they open.">
        <div className="good-roots-tiers good-roots-tiers--two">
          <article className={`good-roots-tier${tier === 'free' ? ' good-roots-tier--current' : ''}`}>
            <header>
              <p className="good-roots-tier__eyebrow">Free</p>
              <p className="good-roots-tier__price">$0</p>
            </header>
            <ul className="site-list">
              <li>Plan and design one garden</li>
              <li>Crop tracking and planting suggestions</li>
              <li>Watering, fertilizer, and harvest reminders</li>
              <li>Share surplus with neighbors when you have extra</li>
            </ul>
          </article>

          <article className="good-roots-tier good-roots-tier--featured good-roots-tier--coming-soon">
            <header>
              <p className="good-roots-tier__eyebrow">Supporter & Pro coming soon</p>
              <p className="good-roots-tier__price">In the works</p>
            </header>
            <p>
              We're building paid tiers that keep the core planning tools free for home gardeners, with
              extras like richer planting recommendations, multi-garden planning, and deeper local growing
              insights. Get on the list and we'll email you the moment they open.
            </p>
            <TierInterestForm tier="either" source="good-roots-tiers" />
          </article>
        </div>
      </Section>

      <Section
        id="organizations"
        title="Gardening as a group?"
        intro="Community gardens, schools, churches, and other groups can use Good Roots to plan shared plots, keep track of who's tending what, and stay organized across a season with a lot of hands. If your group grows more than it needs, sharing the surplus locally comes built in."
        className="good-roots-orgs-section"
      >
        <div className="good-roots-orgs">
          <Card title="How groups use Good Roots" className="good-roots-orgs__perks">
            <ul className="site-list">
              <li>Plan and design shared gardens and community plots</li>
              <li>Keep track of who is growing what across your group</li>
              <li>Your organization's name shown on member garden profiles</li>
              <li>Share surplus harvest with the people you serve</li>
              <li>Light-touch onboarding guidance from our team when you need it</li>
            </ul>
          </Card>
          <Card title="Apply for organization access" className="good-roots-orgs__form">
            <p className="contact-card__eyebrow">Tell us about your group</p>
            <p>
              Share a few details and we'll reach out to help your group get set up in Good Roots.
            </p>
            <OrganizationInquiryForm />
          </Card>
        </div>
      </Section>

      <section className="page-section good-roots-closing">
        <div className="good-roots-closing__copy">
          <h2>Roots grow where hands meet dirt.</h2>
          <p>
            Whether you have a half-acre or a few pots on a balcony, Good Roots helps you plan
            it, grow it, and make the most of everything it gives you. Start with a single bed and let it
            grow from there.
          </p>
          {appHref ? (
            <CtaButton href={appHref} onClick={() => trackPlannerCta('closing')}>
              Open your garden planner
            </CtaButton>
          ) : (
            <CtaButton href={signupPath} onClick={handleInternalClick(signupPath, 'closing')}>
              Start planning for free
            </CtaButton>
          )}
        </div>
      </section>
    </div>
  );
}

export function ContactPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [referral, setReferral] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const canSend =
    name.trim().length > 0 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    message.trim().length > 0;

  const clearFeedback = () => {
    if (feedback) {
      setFeedback(null);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSend || submitting) {
      setFeedback({
        type: 'error',
        message: 'Add your name, a valid email, and a message before sending.',
      });
      return;
    }

    setSubmitting(true);
    setFeedback(null);

    try {
      const response = await fetch(`${webApiBase}/contact`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'general_inquiry',
          contactName: name.trim(),
          email: email.trim(),
          message: message.trim(),
          referral: referral.trim() || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error(`Submission failed (${response.status})`);
      }

      setFeedback({
        type: 'success',
        message: "Thanks. Your message was sent, and we'll reply as soon as we can.",
      });
      setName('');
      setEmail('');
      setMessage('');
      setReferral('');
    } catch (error) {
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : `We couldn't send your message. Please email ${CONTACT_EMAIL} directly.`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHero
        title="Get in touch"
        body="We're a real family running a real garden. Seeds, volunteering, partnerships, or just a note — we actually read everything that comes in."
      />

      <div className="contact-grid">
        <Card title="Send a message" className="contact-card contact-card--form">
          <p className="contact-card__eyebrow">Prefer a form</p>
          <p className="page-text">
            Send a note here and it will go straight to our inbox. Or email us directly at{' '}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
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
              required
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
              required
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
            <Button
              type="submit"
              disabled={!canSend}
              loading={submitting}
            >
              {submitting ? 'Sending...' : 'Send message'}
            </Button>
            {feedback ? (
              <FormFeedback tone={feedback.type}>{feedback.message}</FormFeedback>
            ) : null}
          </form>
        </Card>

        <Card title="Reach us directly" className="contact-card contact-card--details">
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
          <p className="contact-meta">
            Legal name: {foundationOrganization.legalName}
            <br />
            EIN: {foundationOrganization.ein}
            <br />
            Mailing address: {foundationOrganization.mailingAddress.line1},{' '}
            {foundationOrganization.mailingAddress.city},{' '}
            {foundationOrganization.mailingAddress.region}{' '}
            {foundationOrganization.mailingAddress.postalCode}
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
      </div>
    </>
  );
}
