// Canonical SEO/prerender metadata for the foundation site.
//
// Why this file exists:
// - The site is a React SPA. The body served on first byte is just
//   <div id="root"></div>. Crawlers that don't execute JS (LLM training
//   pipelines, basic indexers, simple unfurl bots) see nothing.
// - At build time we walk this list to write per-route dist/<path>/index.html
//   files with route-specific <head> metadata, JSON-LD, and a <noscript>
//   body fallback that contains the page's key copy as plain HTML.
// - The same list also drives sitemap.xml generation so the two never drift.
//
// Keep this list in rough sync with src/site/routes.ts (the runtime route
// table). Routes here must be a subset of paths the React app actually
// renders. Fields here are SEO-only; runtime UI metadata (labels, nav
// placement, redirects) lives in routes.ts.

import faqContent from '../src/site/faq-content.json' with { type: 'json' };
import {
  buildGuideJsonLdBlocks,
  guideRouteMeta,
  renderGuideFallbackHtml,
  renderGuideListHtml,
} from '../src/site/okra-guides/guide-core.mjs';
import { loadOkraGuides } from './okra-guides.mjs';

export const siteUrl = (process.env.VITE_SITE_URL ?? 'https://oliviasgarden.org').replace(/\/+$/, '');
export const instagramUrl = 'https://instagram.com/oliviasgardentx';
export const facebookUrl = 'https://www.facebook.com/profile.php?id=100087146659606#';
export const contactEmail = 'allen@oliviasgarden.org';
export const ein = '33-3101032';
export const irsDeterminationDate = 'March 5, 2025';
export const mailingAddress = {
  streetAddress: '1820 Meadow Ranch Rd',
  addressLocality: 'McKinney',
  addressRegion: 'TX',
  postalCode: '75071',
  addressCountry: 'US',
};
export const defaultImage = '/images/home/og-image.png';
export const defaultImageAlt = "Olivia's Garden Foundation social sharing image.";

// Okra growing guides (src/site/okra-guides/content/*.json). Published guides
// always; drafts only when VITE_INCLUDE_DRAFT_GUIDES=true.
export const okraGuides = loadOkraGuides();
export const logoImage = '/images/icons/logo.svg';

// One organization-level JSON-LD record gets injected into every prerendered
// page. Fields chosen to disambiguate the foundation from name-collisions
// (e.g. other "Olivia"-branded charities) and to give LLMs the basics they
// need to summarize accurately without inferring.
export const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'NonprofitOrganization',
  '@id': `${siteUrl}/#organization`,
  name: "Olivia's Garden Foundation",
  legalName: 'OLIVIAS GARDEN FOUNDATION',
  alternateName: "Olivia's Garden",
  description:
    "Olivia's Garden Foundation is a Texas nonprofit teaching families to grow food, care for animals, preserve harvests, and build practical self-sufficiency. The foundation is run by the Helton family in memory of Olivia.",
  url: siteUrl,
  logo: `${siteUrl}${logoImage}`,
  email: contactEmail,
  taxID: ein,
  foundingDate: '2025',
  foundingLocation: {
    '@type': 'Place',
    address: {
      '@type': 'PostalAddress',
      streetAddress: mailingAddress.streetAddress,
      addressLocality: mailingAddress.addressLocality,
      addressRegion: mailingAddress.addressRegion,
      postalCode: mailingAddress.postalCode,
      addressCountry: mailingAddress.addressCountry,
    },
  },
  address: {
    '@type': 'PostalAddress',
    streetAddress: mailingAddress.streetAddress,
    addressLocality: mailingAddress.addressLocality,
    addressRegion: mailingAddress.addressRegion,
    postalCode: mailingAddress.postalCode,
    addressCountry: mailingAddress.addressCountry,
  },
  areaServed: {
    '@type': 'Country',
    name: 'United States',
  },
  knowsAbout: [
    'Food gardening',
    'Vegetable gardening',
    'Seed saving',
    'Animal husbandry',
    'Beekeeping',
    'Food preservation',
    'Self-sufficiency',
    'Community food sharing',
  ],
  sameAs: [instagramUrl, facebookUrl],
};

// FAQ content lives in src/site/faq-content.json so the React page, the
// prerendered <noscript> fallback, and the FAQPage JSON-LD all come from one
// source and can't drift apart.
const escapeHtml = (value) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const faqBodyFallback = `
      <h1>Frequently asked questions</h1>
${faqContent.sections.map((section) => `      <h2>${escapeHtml(section.title)}</h2>
${section.items.map((item) => `      <h3>${escapeHtml(item.question)}</h3>
      <p>${escapeHtml(item.answer)}${item.link ? ` <a href="${item.link.href}">${escapeHtml(item.link.label)}</a>` : ''}</p>`).join('\n')}`).join('\n')}
    `;

export const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqContent.sections.flatMap((section) => section.items.map((item) => ({
    '@type': 'Question',
    name: item.question,
    acceptedAnswer: { '@type': 'Answer', text: item.answer },
  }))),
};

/** @returns {SeoRoute} */
function buildOkraGuideSeoRoute(guide) {
  const related = (guide.related ?? [])
    .map((slug) => okraGuides.find((candidate) => candidate.slug === slug))
    .filter(Boolean);

  return {
    ...guideRouteMeta(guide),
    sitemap: { changefreq: 'monthly', priority: 0.7, lastmod: guide.dateModified ?? guide.datePublished },
    bodyFallback: renderGuideFallbackHtml(guide, related),
    extraJsonLd: buildGuideJsonLdBlocks(guide, siteUrl),
  };
}

/**
 * @typedef {Object} SeoRoute
 * @property {string} path
 * @property {string} title
 * @property {string} description
 * @property {string} [seoImage]
 * @property {string} [seoImageAlt] - Alt text for seoImage (og:image:alt). Defaults to the site card's alt text.
 * @property {string} [ogType] - og:type value. Defaults to "website".
 * @property {boolean} [allowIndex]
 * @property {boolean} [prerender]
 * @property {string} [canonicalPath] - When set, the canonical link points here instead of `path`. Used for redirect/alias routes.
 * @property {{ changefreq?: string, priority?: number, lastmod?: string }} [sitemap]
 * @property {string} [bodyFallback] - HTML injected inside a <noscript> tag in the body so non-JS crawlers see real content.
 * @property {{ id: string, data: Record<string, unknown> }[]} [extraJsonLd] - Additional page-specific JSON-LD blocks (e.g. FAQPage).
 */

/** @type {SeoRoute[]} */
export const seoRoutes = [
  {
    path: '/',
    title: "Olivia's Garden Foundation",
    description:
      "Olivia's Garden Foundation is a Texas nonprofit teaching families to grow food, care for animals, preserve harvests, and build practical self-sufficiency.",
    seoImage: defaultImage,
    prerender: true,
    sitemap: { changefreq: 'weekly', priority: 1.0 },
    bodyFallback: `
      <h1>Olivia's Garden Foundation</h1>
      <p>
        Olivia's Garden Foundation is a 501(c)(3) nonprofit based in McKinney, Texas, founded in
        2025 in memory of Olivia. We help individuals and families learn how to grow food,
        care for animals, preserve what they produce, and build practical self-sufficiency through
        real work on a functioning property.
      </p>
      <h2>Our mission</h2>
      <p>
        Practical food-growing education for families and the wider community. We teach through
        real work on a working property in McKinney, then share that work in ways that help more
        people start growing, raising, preserving, and sharing food of their own &mdash; while
        connecting growers with each other and with people in their communities who need fresh
        food.
      </p>
      <h2>What we do</h2>
      <ul>
        <li>Teach from real, ongoing work on the land &mdash; not classroom theory.</li>
        <li>Make starting feel possible for first-time growers.</li>
        <li>Stay honest about the messy reality of food-growing.</li>
        <li>Share what we learn so more people can start where they are.</li>
      </ul>
      <h2>Programs and ways to take part</h2>
      <ul>
        <li><a href="/okra">The Okra Project</a> &mdash; request free okra seeds from Olivia's own seed line, and add your garden to the project map.</li>
        <li><a href="/good-roots">Good Roots Network</a> &mdash; a garden planning app for deciding what to plant, designing your beds, and staying on top of the season, with neighbor-to-neighbor food sharing built in.</li>
        <li><a href="/get-involved">Get involved</a> &mdash; request seeds, add your garden to the map, or tell us you&rsquo;d like to help in person once we open.</li>
        <li><a href="/donate">Donate</a> &mdash; one-time gifts and Garden Club recurring support, with a permanent named marker placed in the memorial garden for every donor.</li>
        <li><a href="/about">About Olivia's Garden</a> &mdash; the story behind the foundation and the family who runs it.</li>
        <li><a href="/contact">Contact</a> &mdash; reach the Helton family directly.</li>
      </ul>
    `,
  },
  {
    path: '/about',
    title: "About Olivia's Garden",
    description:
      "Meet Olivia, the little girl who loved eating okra straight from the plant, and learn how her family is building a garden and foundation in her memory.",
    seoImage: '/images/social/about.png',
    seoImageAlt: "Sunset over the memorial garden's raised beds, with the headline: Olivia's Garden: the story.",
    prerender: true,
    sitemap: { changefreq: 'monthly', priority: 0.8 },
    bodyFallback: `
      <h1>About Olivia's Garden</h1>
      <p>
        Olivia's Garden Foundation is a 501(c)(3) nonprofit in McKinney, Texas. It was founded in
        2025 in memory of Olivia, a four-year-old who loved being in the garden, working
        with animals, and helping with whatever was happening on the family's land.
      </p>
      <h2>How the foundation began</h2>
      <p>
        Olivia was diagnosed with AML (acute myeloid leukemia) in 2023. After she passed, her
        parents Allen and Mallory wanted to build something in her memory. The first idea was to
        grow and provide locally available food to families going through pediatric cancer
        treatment. As they built the garden, the mission grew: not just food, but the practical
        skills that make a family more capable and self-reliant.
      </p>
      <h2>Who runs it</h2>
      <p>
        The foundation is run by the Helton family &mdash; Allen, Mallory, and Isabella &mdash;
        out of McKinney, Texas. The work happens on a functioning property with garden beds, a
        small Texas vineyard, a pond, chickens, turkeys, geese, goats, bees, and guineas.
      </p>
      <p>
        Read more about <a href="/impact">what we're growing now</a>, <a href="/get-involved">how to get involved</a>,
        or <a href="/contact">reach out directly</a>.
      </p>
    `,
  },
  {
    path: '/get-involved',
    title: 'Get involved',
    description:
      "Request free okra seeds, add your garden to the map, or follow along with Olivia's Garden. Share your interest in helping in person when the garden opens.",
    seoImage: '/images/social/get-involved.png',
    seoImageAlt: "Hands tending seedlings in a raised garden bed, with the headline: Start where you are.",
    prerender: true,
    sitemap: { changefreq: 'weekly', priority: 0.8 },
    bodyFallback: `
      <h1>Get involved with Olivia's Garden Foundation</h1>
      <p>
        There are several clear ways to be part of the work at Olivia's Garden Foundation right
        now in McKinney, Texas, and a few more being built.
      </p>
      <ul>
        <li>
          <strong>Start with seeds.</strong> Request free okra seeds from Olivia's own seed line
          through <a href="/okra">The Okra Project</a> &mdash; the easiest first step into growing food.
        </li>
        <li>
          <strong>Help in person.</strong> We aren&rsquo;t open for visits or volunteer days yet.
          <a href="/contact">Tell us you&rsquo;re interested</a> and we&rsquo;ll reach out when we are.
        </li>
        <li>
          <strong>Hands-on workshops.</strong> We&rsquo;re planning workshops built around real
          tasks rather than classroom-style theory. Nothing is scheduled yet;
          <a href="/workshops">tell us what you&rsquo;d like to learn</a>.
        </li>
        <li>
          <strong>Help map where food is growing.</strong> Add your garden as a pin on the Okra
          Project map &mdash; every garden makes the case that this is normal and worth doing.
        </li>
        <li>
          <strong>Support the foundation financially.</strong> <a href="/donate">Donate</a> to
          the garden, animals, tools, and community programs. Every donor receives a permanent
          named acrylic marker in the memorial garden.
        </li>
      </ul>
    `,
  },
  {
    path: '/okra',
    title: 'The Okra Project',
    description:
      "Request free seeds from Olivia's okra, find growers on the Okra Project map, and add your garden to a seed-sharing story growing across the country.",
    seoImage: '/images/social/okra.png',
    seoImageAlt: "Green okra pods beside a seed packet, with the headline: Free okra seeds from Olivia's garden.",
    prerender: true,
    sitemap: { changefreq: 'weekly', priority: 0.9 },
    bodyFallback: `
      <h1>The Okra Project</h1>
      <p>
        Okra was Olivia's favorite thing to grow. Olivia's Garden Foundation has kept her
        plants going and now mails free okra seeds to anyone who wants to grow them.
      </p>
      <h2>How it works</h2>
      <ol>
        <li>
          <strong>Request seeds.</strong> Fill out a short form and we mail you okra seeds from
          Olivia's line, completely free, with no sign-up required.
        </li>
        <li>
          <strong>Grow them.</strong> Plant in a garden bed, containers, or wherever you have
          space. Okra is forgiving, tolerates heat, bounces back from neglect, and produces more
          than you expect.
        </li>
        <li>
          <strong>Add your garden to the map.</strong> Take a photo and add a pin so every
          Okra Project garden becomes visible.
        </li>
      </ol>
${renderGuideListHtml(okraGuides)}
      <p>
        See related work at <a href="/good-roots">Good Roots Network</a>, learn the
        <a href="/about">story behind the foundation</a>, or <a href="/donate">support the
        program</a>.
      </p>
    `,
  },
  {
    path: '/impact',
    title: "What we're building",
    description:
      "See what's growing at Olivia's Garden in McKinney, Texas: seasonal vegetables, flowers, animals, and the next steps for seed sharing and hands-on learning.",
    seoImage: '/images/social/impact.png',
    seoImageAlt: "A basket of freshly harvested vegetables on the grass, with the headline: What we're growing.",
    prerender: true,
    sitemap: { changefreq: 'monthly', priority: 0.7 },
    bodyFallback: `
      <h1>What's growing at Olivia's Garden right now</h1>
      <p>
        The foundation is already doing real work. On the land in McKinney, Texas right now:
        productive garden beds, flowers, chickens, turkeys, geese, goats, bees, and guineas. A
        small Texas vineyard. A pond used to observe and teach about micro-ecosystems.
      </p>
      <p>
        Seasonal crops include carrots, beets, broccoli, cauliflower, eggplant, tomatoes, peppers,
        onions, artichokes, beans, zucchini, and cucumbers. Borage, zinnias, cosmos, day lilies,
        forget-me-nots, and Colossus marigolds (Olivia's favorite) grow border to border.
      </p>
      <h2>Where we're going</h2>
      <p>
        Down the road comes a fuller public program: stronger seed sharing through
        <a href="/okra">The Okra Project</a>, more structured ways to share what the foundation
        grows with the community, and, once we open the gate, hands-on workshops. <a href="/get-involved">Get involved</a> or
        <a href="/donate">support the work</a>.
      </p>
    `,
  },
  {
    path: '/workshops',
    title: 'Workshops',
    description:
      "Hands-on workshops at Olivia's Garden Foundation: garden prep, animal care, food preservation, and more. Sign up or get on the waitlist for upcoming sessions.",
    seoImage: defaultImage,
    prerender: true,
    sitemap: { changefreq: 'weekly', priority: 0.7 },
    bodyFallback: `
      <h1>Workshops at Olivia's Garden Foundation</h1>
      <p>
        Workshops at Olivia's Garden Foundation are built around real tasks &mdash; garden prep,
        animal care, food preservation, and the practical skills behind growing food at home.
        Sessions are hands-on rather than classroom-style, so you spend the time doing the work,
        not watching it.
      </p>
      <p>
        Browse upcoming workshops on the website to register, join a waitlist, or tell us
        you&rsquo;re interested in workshops we&rsquo;re still planning. The list is loaded
        from the foundation API, so what shows in your browser is always the current schedule.
      </p>
      <p>
        If you have a workshop topic in mind that isn&rsquo;t scheduled yet,
        <a href="/contact">contact the foundation</a> and let us know what you&rsquo;d like
        to learn.
      </p>
    `,
  },
  {
    path: '/donate',
    title: "Support Olivia's Garden",
    description:
      "Help Olivia's Garden grow with a one-time gift or monthly Garden Club support. Every donor receives a named marker in the memorial garden.",
    seoImage: '/images/social/donate.png',
    seoImageAlt: "An orange bee-shaped donor marker in the grass, with the headline: Plant something permanent.",
    prerender: true,
    sitemap: { changefreq: 'weekly', priority: 0.8 },
    bodyFallback: `
      <h1>Support Olivia's Garden Foundation</h1>
      <p>
        Donations to Olivia's Garden Foundation fund seeds, animal care, tools, educational
        materials, and the practical work of keeping the foundation active for families who want
        to learn how to grow, tend, and share food. Olivia's Garden Foundation is a 501(c)(3)
        nonprofit based in McKinney, Texas.
      </p>
      <h2>Garden markers for every donor</h2>
      <p>
        Every donor receives a permanent named acrylic marker placed in the memorial garden,
        regardless of donation size. The marker design changes each year so the installation
        keeps growing while still marking a moment in the life of the garden.
      </p>
      <h2>Garden Club recurring support</h2>
      <p>
        Garden Club members make a recurring donation and receive a free t-shirt when they
        begin their support, alongside their permanent garden marker. One-time gifts are also
        welcome. See <a href="/impact">what's growing now</a> or
        <a href="/about">read about the foundation</a>.
      </p>
    `,
  },
  {
    path: '/contact',
    title: 'Get in touch',
    description:
      "Contact Olivia's Garden Foundation for volunteering, seeds, donations, partnerships, and general questions.",
    seoImage: defaultImage,
    prerender: true,
    sitemap: { changefreq: 'monthly', priority: 0.7 },
    bodyFallback: `
      <h1>Contact Olivia's Garden Foundation</h1>
      <p>
        Olivia's Garden Foundation is run by the Helton family in McKinney, Texas. Email is the
        fastest way to reach us, especially for sharing photos of your garden, asking about
        volunteering, requesting seeds, partnerships, or just sending a note.
      </p>
      <ul>
        <li>Email: <a href="mailto:${contactEmail}">${contactEmail}</a></li>
        <li>Mailing address: ${mailingAddress.streetAddress}, ${mailingAddress.addressLocality}, ${mailingAddress.addressRegion} ${mailingAddress.postalCode}</li>
        <li>Legal name: Olivia's Garden Foundation &mdash; EIN ${ein}</li>
        <li>Instagram: <a href="${instagramUrl}">@oliviasgardentx</a> &mdash; day-to-day work, harvests, animals.</li>
        <li>Facebook: <a href="${facebookUrl}">Olivia's Garden Foundation on Facebook</a> &mdash; events and community posts.</li>
      </ul>
    `,
  },
  {
    path: '/good-roots',
    title: 'Good Roots Network',
    description:
      "Plan your garden beds, choose crops, and keep up with watering and harvest reminders. Try Good Roots Network free and share extra produce with neighbors.",
    seoImage: '/images/social/good-roots.png',
    seoImageAlt: "The Good Roots garden bed planner in a browser frame beside a garden photo, with the headline: Plan a garden you can keep up with.",
    allowIndex: false,
    prerender: true,
    sitemap: { changefreq: 'weekly', priority: 0.6 },
    bodyFallback: `
      <h1>Good Roots Network</h1>
      <p>
        Good Roots Network is part of Olivia's Garden Foundation. It's a garden planning app that
        helps home gardeners decide what to plant, design their beds, and keep up with the season.
        When your garden gives you more than you can use, sharing the extra with neighbors is built in.
      </p>
      <h2>How it works</h2>
      <ol>
        <li>Set up your garden and add the beds you're working with this season.</li>
        <li>Plan what to plant with crops suited to your space, and see what grows well nearby.</li>
        <li>Stay on track with watering, fertilizer, and harvest reminders.</li>
        <li>Share the extra when a crop comes in heavy by offering the surplus to neighbors who can use it.</li>
      </ol>
      <p>
        Free is live today: plan and design one garden, track your crops, and get reminders, with
        neighbor food sharing included. Paid Supporter and Pro tiers are in the works and will add
        things like multi-garden planning, season history, and richer planting recommendations.
        Sign up on the page to be notified when they open.
      </p>
    `,
  },
  {
    path: '/partners',
    title: 'Partner with us',
    description:
      "Partner with Olivia's Garden Foundation: sponsor free okra seeds through bulk growing or satellite seed sharing. For extension programs, colleges, nonprofits, and local businesses.",
    seoImage: defaultImage,
    prerender: true,
    sitemap: { changefreq: 'monthly', priority: 0.6 },
    bodyFallback: `
      <h1>Partner with Olivia's Garden Foundation</h1>
      <p>
        Olivia's Garden Foundation is a young, family-run 501(c)(3) nonprofit in McKinney, Texas
        (EIN ${ein}). We'd like to grow alongside organizations that share the work of helping
        people grow their own food. We don't have any partners yet.
      </p>
      <h2>Who we'd love to work with</h2>
      <ul>
        <li><strong>Extension and Master Gardener programs</strong>, such as Texas A&amp;M AgriLife Extension and county Master Gardener associations.</li>
        <li><strong>Colleges and universities</strong>, including agriculture, horticulture, and nutrition programs at Texas A&amp;M and other schools.</li>
        <li><strong>Nonprofits and food access groups</strong>, such as food pantries, community gardens, and faith communities, as local sharing spots for free okra seeds.</li>
        <li><strong>Local businesses</strong>, such as garden centers and feed stores.</li>
      </ul>
      <h2>Ways to sponsor</h2>
      <ul>
        <li><strong>Bulk growing.</strong> Grow a plot of Clemson Spineless okra from Olivia's line and save the seed, so more free packets can go out.</li>
        <li><strong>Satellite sharing.</strong> Become a local sharing spot: we send you okra seed packets and you hand them out in your community.</li>
      </ul>
      <h2>Other ways to help</h2>
      <ul>
        <li>Share growing expertise for our guides and FAQ.</li>
        <li>Donate seeds, tools, or supplies.</li>
        <li>Plan future hands-on programs with us once we open the gate.</li>
      </ul>
      <p>
        To start a conversation, use the form on this page or email
        <a href="mailto:${contactEmail}?subject=Partnership">${contactEmail}</a>.
      </p>
    `,
  },
  {
    path: '/faq',
    title: 'Frequently asked questions',
    description:
      "Find answers about requesting free okra seeds, growing Clemson Spineless okra, tax-deductible gifts, Garden Club, and when the garden will open.",
    seoImage: '/images/social/faq.png',
    seoImageAlt: "A seedling growing from soil beside the headline: Questions? We've got answers.",
    prerender: true,
    sitemap: { changefreq: 'monthly', priority: 0.6 },
    bodyFallback: faqBodyFallback,
    extraJsonLd: [{ id: 'faq', data: faqJsonLd }],
  },
  {
    path: '/privacy',
    title: 'Privacy Policy',
    description:
      "Read how Olivia's Garden Foundation collects, uses, stores, and protects information across the foundation website, donations, and account features.",
    prerender: true,
    sitemap: { changefreq: 'yearly', priority: 0.3 },
    bodyFallback: `
      <h1>Privacy Policy</h1>
      <p>
        This policy explains what information Olivia's Garden Foundation collects, how it's used,
        and the choices available to people who visit the site, donate, sign up, or participate
        in foundation programs and online tools. The full policy covers information collected,
        how it's used and shared, account and sign-in data, cookies and analytics, data
        retention, children's privacy, your choices, security, and changes to the policy.
        Questions can be sent to <a href="mailto:${contactEmail}">${contactEmail}</a>.
      </p>
    `,
  },
  {
    path: '/terms',
    title: 'Terms of Service',
    description:
      "Review the terms that govern use of Olivia's Garden Foundation websites, accounts, donations, community tools, and submitted content.",
    prerender: true,
    sitemap: { changefreq: 'yearly', priority: 0.3 },
    bodyFallback: `
      <h1>Terms of Service</h1>
      <p>
        These terms govern access to and use of Olivia's Garden Foundation websites, accounts,
        donation experiences, and related community tools. They cover acceptance of terms, use
        of the site, accounts, donations and payments, user submissions, intellectual property,
        third-party services, disclaimers, limitation of liability, indemnification, termination,
        governing law (State of Texas), and changes to the terms. Questions can be sent to
        <a href="mailto:${contactEmail}">${contactEmail}</a>.
      </p>
    `,
  },
  {
    path: '/refunds',
    title: 'Refund Policy',
    description:
      "Review Olivia's Garden Foundation's refund and cancellation policy for one-time donations and recurring Garden Club support.",
    prerender: true,
    sitemap: { changefreq: 'yearly', priority: 0.3 },
    bodyFallback: `
      <h1>Refund Policy</h1>
      <p>
        One-time donations to Olivia's Garden Foundation are refundable within 7 days for
        accidental gifts, incorrect amounts, duplicate donations, or other donations made in
        error. After 7 days, one-time donations are generally final unless a refund is required
        by law or approved by the foundation.
      </p>
      <p>
        Garden Club recurring support can be canceled at any time. Cancellation stops future
        charges, including cancel-at-period-end requests when supported by the payment provider.
        Past monthly donations are generally not refunded unless they were accidental,
        duplicated, or required to be refunded by law.
      </p>
      <p>
        To request a refund or cancellation, email
        <a href="mailto:${contactEmail}">${contactEmail}</a> with the transaction reference,
        donation date, donation amount, and the email used for the donation. We respond within
        5 business days. If a donation is refunded, the refunded amount is no longer a completed
        charitable contribution and any related tax deduction should be reversed or excluded.
      </p>
    `,
  },
  {
    path: '/transparency',
    title: 'Transparency and organization information',
    description:
      "Olivia's Garden Foundation organization details: legal name, EIN, mailing address, IRS 501(c)(3) determination, leadership, and financial transparency.",
    seoImage: defaultImage,
    prerender: true,
    sitemap: { changefreq: 'monthly', priority: 0.5 },
    bodyFallback: `
      <h1>Transparency</h1>
      <p>
        Olivia's Garden Foundation publishes the public information about the organization here:
        legal status, leadership, mailing address, financial situation, and where to find our
        public filings.
      </p>
      <h2>Organization details</h2>
      <ul>
        <li>Legal name: Olivia's Garden Foundation</li>
        <li>EIN: ${ein}</li>
        <li>Tax status: 501(c)(3) public charity, recognized by the United States Internal Revenue Service</li>
        <li>IRS determination date: ${irsDeterminationDate}</li>
        <li>Year founded: 2025</li>
        <li>State of incorporation: Texas</li>
        <li>Mailing address: ${mailingAddress.streetAddress}, ${mailingAddress.addressLocality}, ${mailingAddress.addressRegion} ${mailingAddress.postalCode}, USA</li>
      </ul>
      <h2>Leadership</h2>
      <p>
        Olivia's Garden Foundation is run by the Helton family of McKinney, Texas: Allen Helton
        (co-founder, president), Mallory Helton (co-founder), and Isabella Helton (family
        contributor). The foundation has no paid staff.
      </p>
      <h2>Mission and programs</h2>
      <p>
        The foundation teaches individuals and families how to grow food, care for animals,
        preserve what they produce, and build practical self-sufficiency. Programs include The
        Okra Project (free seeds and a public garden map) and the Good Roots Network online
        platform. Hands-on workshops and in-person volunteer days are planned for the future.
      </p>
      <h2>Non-discrimination policy</h2>
      <p>
        Olivia's Garden Foundation does not discriminate on the basis of race, color, ethnic or
        national origin, ancestry, gender, gender identity or expression, sexual orientation, age,
        disability, religion, marital status, military or veteran status, or any other category
        protected by applicable law in the administration of our programs, services, volunteer
        opportunities, or employment. This applies to seed program participants, workshop
        attendees, volunteers, donors, partners, and anyone else who interacts with the foundation.
      </p>
      <h2>Financial information</h2>
      <p>
        Olivia's Garden Foundation was founded in 2025 and received IRS 501(c)(3) recognition on
        ${irsDeterminationDate}. Because we are a new organization, we do not yet have a published
        annual report or a filed Form 990. Our first IRS filing, covering our initial reporting
        period, will be made in 2026, and a summary will be posted on this page once filed. We
        expect to file Form 990-N (e-Postcard) at our current scale.
      </p>
      <p>
        Donations fund seeds and garden materials, lumber and hardware for raised beds and
        animal enclosures, feed and care for the animals, workshop supplies, seed-program
        shipping, and the software and hosting costs of the foundation's online tools. The
        foundation has no paid staff, no office lease, and no fundraising contractors.
      </p>
      <h2>Public records and filings</h2>
      <p>
        Our 501(c)(3) status can be independently verified through the IRS Tax Exempt
        Organization Search at <a href="https://apps.irs.gov/app/eos/">apps.irs.gov/app/eos</a>
        using EIN ${ein}. We also maintain a public profile on Candid.
      </p>
    `,
  },
  {
    path: '/data',
    title: 'Data and account deletion',
    description:
      "How to delete your Olivia's Garden Foundation account and the personal data associated with it, including data from Facebook or Google sign-in.",
    prerender: true,
    sitemap: { changefreq: 'yearly', priority: 0.3 },
    bodyFallback: `
      <h1>Data and account deletion</h1>
      <p>
        How to permanently delete your Olivia's Garden Foundation account and the personal data
        tied to it, including data received from Facebook Login or Google Sign-In. Account
        holders can delete from the profile page (Sign in &rarr; Profile &rarr; Danger zone
        &rarr; Delete my account). If you can't sign in, email
        <a href="mailto:${contactEmail}?subject=Account%20deletion%20request">${contactEmail}</a>
        with the subject "Account deletion request" and the email or social sign-in you used.
        Email-based requests are processed within 30 days.
      </p>
    `,
  },
  ...okraGuides.map(buildOkraGuideSeoRoute),
];

export const prerenderRoutes = seoRoutes.filter((route) => route.prerender);
