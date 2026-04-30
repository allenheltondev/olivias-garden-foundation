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

export const siteUrl = (process.env.VITE_SITE_URL ?? 'https://oliviasgarden.org').replace(/\/+$/, '');
export const instagramUrl = 'https://instagram.com/oliviasgardentx';
export const facebookUrl = 'https://www.facebook.com/profile.php?id=100087146659606#';
export const contactEmail = 'allen@oliviasgarden.org';
export const defaultImage = '/images/home/og-image.png';
export const defaultImageAlt = "Olivia's Garden Foundation social sharing image.";
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
    "Olivia's Garden Foundation is a Texas nonprofit teaching families to grow food, care for animals, preserve harvests, and build practical self-sufficiency. The foundation is run by the Helton family in memory of Olivia Helton.",
  url: siteUrl,
  logo: `${siteUrl}${logoImage}`,
  email: contactEmail,
  foundingDate: '2025',
  foundingLocation: {
    '@type': 'Place',
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'McKinney',
      addressRegion: 'TX',
      addressCountry: 'US',
    },
  },
  address: {
    '@type': 'PostalAddress',
    addressLocality: 'McKinney',
    addressRegion: 'TX',
    addressCountry: 'US',
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

/**
 * @typedef {Object} SeoRoute
 * @property {string} path
 * @property {string} title
 * @property {string} description
 * @property {string} [seoImage]
 * @property {boolean} [allowIndex]
 * @property {boolean} [prerender]
 * @property {string} [canonicalPath] - When set, the canonical link points here instead of `path`. Used for redirect/alias routes.
 * @property {{ changefreq?: string, priority?: number }} [sitemap]
 * @property {string} [bodyFallback] - HTML injected inside a <noscript> tag in the body so non-JS crawlers see real content.
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
        2025 in memory of Olivia Helton. We help individuals and families learn how to grow food,
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
        <li><a href="/good-roots">Good Roots Network</a> &mdash; a community platform connecting home growers with neighbors and organizations who need fresh food.</li>
        <li><a href="/get-involved">Get involved</a> &mdash; volunteer at work days, request seeds, or join workshops as they launch.</li>
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
      "Read Olivia's story, the foundation's mission, and the family-led work behind practical food-growing education in McKinney, Texas.",
    seoImage: defaultImage,
    prerender: true,
    sitemap: { changefreq: 'monthly', priority: 0.8 },
    bodyFallback: `
      <h1>About Olivia's Garden</h1>
      <p>
        Olivia's Garden Foundation is a 501(c)(3) nonprofit in McKinney, Texas. It was founded in
        2025 in memory of Olivia Helton, a four-year-old who loved being in the garden, working
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
      "Find ways to support Olivia's Garden Foundation through volunteering, seed sharing, workshops, and community participation.",
    seoImage: defaultImage,
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
          <strong>Come work the land.</strong> Regular volunteer work days cover garden prep,
          animal care for chickens, turkeys, geese, goats, bees, and guineas, and event setup.
          <a href="/contact">Sign up to volunteer</a>.
        </li>
        <li>
          <strong>Hands-on workshops &mdash; coming soon.</strong> Workshops are planned around
          real tasks and hands-on learning rather than classroom-style theory.
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
      "Request free okra seeds, add your garden to the Okra Project map, and join a public invitation to grow food and share the story back.",
    seoImage: defaultImage,
    prerender: true,
    sitemap: { changefreq: 'weekly', priority: 0.9 },
    bodyFallback: `
      <h1>The Okra Project</h1>
      <p>
        Okra was Olivia Helton's favorite thing to grow. Olivia's Garden Foundation has kept her
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
      "See what Olivia's Garden Foundation is growing now, from garden beds and animals to the next phase of community programs.",
    seoImage: defaultImage,
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
        The next phase is a fuller public program: hands-on workshops, stronger seed sharing
        through <a href="/okra">The Okra Project</a>, and more structured ways to share what the
        foundation grows with the community. <a href="/get-involved">Get involved</a> or
        <a href="/donate">support the work</a>.
      </p>
    `,
  },
  {
    path: '/donate',
    title: "Support Olivia's Garden",
    description:
      "Donate to Olivia's Garden Foundation through one-time gifts or Garden Club recurring support, with a permanent named garden marker for every donor.",
    seoImage: defaultImage,
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
        <li>Instagram: <a href="${instagramUrl}">@oliviasgardentx</a> &mdash; day-to-day work, harvests, animals.</li>
        <li>Facebook: <a href="${facebookUrl}">Olivia's Garden Foundation on Facebook</a> &mdash; events and community posts.</li>
      </ul>
    `,
  },
  {
    path: '/good-roots',
    title: 'Good Roots Network',
    description:
      'A community platform that connects home growers with neighbors and organizations who need fresh food. Plan your garden, see local food gaps, and share what you have extra.',
    seoImage: defaultImage,
    allowIndex: false,
    prerender: true,
    sitemap: { changefreq: 'weekly', priority: 0.6 },
    bodyFallback: `
      <h1>Good Roots Network</h1>
      <p>
        Good Roots Network is part of Olivia's Garden Foundation. It's a community platform that
        connects home growers with the people and organizations who need fresh food: families,
        food pantries, shelters, schools, and mutual-aid groups.
      </p>
      <h2>How it works</h2>
      <ol>
        <li>Register your garden and tell the network what you're planting this season.</li>
        <li>See the local picture &mdash; every garden in the network shows up on a map so you can spot what's over-planted and what's missing.</li>
        <li>List what's extra when a crop comes in heavy.</li>
        <li>Gather what you need from nearby listings, claim it, and pick it up directly from the grower.</li>
      </ol>
      <p>
        Tiers: Free includes one garden, basic planner, browsing, and your neighborhood food
        map. Supporter ($10/month) adds multiple gardens, season history, and advanced planning.
        Pro ($50/month, 30-day free trial) adds AI planting recommendations based on local gaps,
        season-aware timing, and troubleshooting help.
      </p>
    `,
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
];

export const prerenderRoutes = seoRoutes.filter((route) => route.prerender);
