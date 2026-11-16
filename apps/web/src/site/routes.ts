import { okraGuideRoutes } from './okra-guides';

export type AppRoute = {
  path: string;
  label: string;
  title: string;
  description: string;
  seoImage?: string;
  /** Alt text for seoImage (og:image:alt). Required whenever seoImage is page-specific. */
  seoImageAlt?: string;
  /** og:type; defaults to "website". */
  ogType?: 'website' | 'article';
  allowIndex?: boolean;
  showInNav?: boolean;
  showInFooter?: boolean;
  showInLegalFooter?: boolean;
  prerender?: boolean;
};

export const socialShareImage = '/images/home/og-image.png';

export const routes: AppRoute[] = [
  {
    path: '/',
    label: 'Home',
    showInNav: true,
    showInFooter: true,
    title: "Olivia's Garden Foundation",
    description: "Olivia's Garden Foundation is a Texas nonprofit teaching families to grow food, care for animals, preserve harvests, and build practical self-sufficiency.",
    seoImage: socialShareImage,
    prerender: true,
  },
  {
    path: '/auth/callback',
    label: 'Auth callback',
    title: 'Sign in',
    description: 'Complete sign-in for the foundation web app.',
    allowIndex: false,
  },
  {
    path: '/login',
    label: 'Login',
    title: 'Log in',
    description: "Use one Olivia's Garden account across the website, garden planner, and store.",
    allowIndex: false,
  },
  {
    path: '/about',
    label: 'About',
    showInNav: true,
    showInFooter: true,
    title: "About Olivia's Garden",
    description: "Meet Olivia, the little girl who loved eating okra straight from the plant, and learn how her family is building a garden and foundation in her memory.",
    seoImage: '/images/social/about.png',
    seoImageAlt: "Sunset over the memorial garden's raised beds, with the headline: Olivia's Garden: the story.",
    prerender: true,
  },
  {
    path: '/get-involved',
    label: 'Get Involved',
    showInFooter: true,
    title: 'Get involved',
    description: "Request free okra seeds, add your garden to the map, or follow along with Olivia's Garden. Share your interest in helping in person when the garden opens.",
    seoImage: '/images/social/get-involved.png',
    seoImageAlt: "Hands tending seedlings in a raised garden bed, with the headline: Start where you are.",
    prerender: true,
  },
  {
    path: '/okra',
    label: 'Okra Project',
    showInNav: true,
    showInFooter: true,
    title: 'The Okra Project',
    description: "Request free seeds from Olivia's okra, find growers on the Okra Project map, and add your garden to a seed-sharing story growing across the country.",
    seoImage: '/images/social/okra.png',
    seoImageAlt: "Green okra pods beside a seed packet, with the headline: Free okra seeds from Olivia's garden.",
    prerender: true,
  },
  {
    path: '/good-roots',
    label: 'Garden Planner',
    showInNav: true,
    title: 'Free online garden planner',
    description: "Good Roots is a free online garden planner for your browser and phone. Lay out your beds, choose crops, and get watering and harvest reminders. Nothing to download.",
    seoImage: '/images/social/good-roots.png',
    seoImageAlt: "The Good Roots garden bed planner in a browser frame beside a garden photo, with the headline: Plan a garden you can keep up with.",
    allowIndex: false,
    prerender: true,
  },
  {
    path: '/impact',
    label: 'Impact',
    showInFooter: true,
    title: "What we're building",
    description: "See what's growing at Olivia's Garden in McKinney, Texas: seasonal vegetables, flowers, animals, and the next steps for seed sharing and hands-on learning.",
    seoImage: '/images/social/impact.png',
    seoImageAlt: "A basket of freshly harvested vegetables on the grass, with the headline: What we're growing.",
    prerender: true,
  },
  {
    path: '/workshops',
    label: 'Workshops',
    showInFooter: true,
    title: 'Workshops',
    description: "Hands-on workshops at Olivia's Garden Foundation: garden prep, animal care, food preservation, and more. Sign up or get on the waitlist for upcoming sessions.",
    seoImage: socialShareImage,
    prerender: true,
  },
  {
    path: '/donate',
    label: 'Donate',
    showInNav: true,
    showInFooter: true,
    title: "Support Olivia's Garden",
    description: "Help Olivia's Garden grow with a one-time gift or monthly Garden Club support. Every donor receives a named marker in the memorial garden.",
    seoImage: '/images/social/donate.png',
    seoImageAlt: "An orange bee-shaped donor marker in the grass, with the headline: Plant something permanent.",
    prerender: true,
  },
  {
    path: '/profile',
    label: 'Profile',
    title: 'Your profile',
    description: "Personalize your Olivia's Garden profile and review your history of seed requests, okra submissions, and donations.",
    allowIndex: false,
  },
  {
    path: '/okra/submissions',
    label: 'My okra submissions',
    title: 'Your okra submissions',
    description: 'Review and edit okra submissions tied to your account.',
    allowIndex: false,
  },
  {
    path: '/contact',
    label: 'Contact',
    showInFooter: true,
    title: 'Get in touch',
    description: "Contact Olivia's Garden Foundation for volunteering, seeds, donations, partnerships, and general questions.",
    seoImage: socialShareImage,
    prerender: true,
  },
  {
    path: '/partners',
    label: 'Partner with us',
    showInFooter: true,
    title: 'Partner with us',
    description: "Partner with Olivia's Garden Foundation: sponsor free okra seeds through bulk growing or satellite seed sharing. For extension programs, colleges, nonprofits, and local businesses.",
    seoImage: '/images/social/partners.png',
    seoImageAlt: "A pile of hundreds of saved okra seeds on cream linen, with the headline: Help Olivia's okra spread.",
    prerender: true,
  },
  {
    path: '/faq',
    label: 'FAQ',
    showInFooter: true,
    title: 'Frequently asked questions',
    description: "Find answers about requesting free okra seeds, growing Clemson Spineless okra, tax-deductible gifts, Garden Club, and when the garden will open.",
    seoImage: '/images/social/faq.png',
    seoImageAlt: "A seedling growing from soil beside the headline: Questions? We've got answers.",
    prerender: true,
  },
  {
    path: '/privacy',
    label: 'Privacy Policy',
    showInLegalFooter: true,
    title: 'Privacy Policy',
    description: "Read how Olivia's Garden Foundation collects, uses, stores, and protects information across the foundation website, donations, and account features.",
    allowIndex: true,
    prerender: true,
  },
  {
    path: '/terms',
    label: 'Terms of Service',
    showInLegalFooter: true,
    title: 'Terms of Service',
    description: "Review the terms that govern use of Olivia's Garden Foundation websites, accounts, donations, community tools, and submitted content.",
    allowIndex: true,
    prerender: true,
  },
  {
    path: '/refunds',
    label: 'Refund Policy',
    showInLegalFooter: true,
    title: 'Refund Policy',
    description: "Review Olivia's Garden Foundation's refund and cancellation policy for one-time donations and recurring Garden Club support.",
    allowIndex: true,
    prerender: true,
  },
  {
    path: '/data',
    label: 'Your data',
    showInLegalFooter: true,
    title: 'Data and account deletion',
    description: "How to delete your Olivia's Garden Foundation account and the personal data associated with it, including data from Facebook or Google sign-in.",
    allowIndex: true,
    prerender: true,
  },
  {
    path: '/transparency',
    label: 'Transparency',
    showInLegalFooter: true,
    title: 'Transparency and organization information',
    description: "Olivia's Garden Foundation organization details: legal name, EIN, mailing address, IRS 501(c)(3) determination, leadership, and financial transparency.",
    seoImage: socialShareImage,
    allowIndex: true,
    prerender: true,
  },
  // Okra growing guides (/okra/<slug>), from src/site/okra-guides/content.
  ...okraGuideRoutes,
];

export const notFoundRoute: AppRoute = {
  path: '*',
  label: 'Page not found',
  title: 'Page not found',
  description: "This page could not be found on Olivia's Garden Foundation.",
  seoImage: socialShareImage,
  allowIndex: false,
};

const primaryPageOrder = new Map([
  ['/', 0],
  ['/okra', 1],
  ['/workshops', 2],
  ['/donate', 3],
  ['/good-roots', 4],
  ['/about', 5],
  ['/get-involved', 6],
  ['/impact', 7],
  ['/faq', 8],
  ['/partners', 9],
]);

// Okra guides shown in nav/footer sort right after "Okra Project".
function pageOrder(route: AppRoute) {
  return primaryPageOrder.get(route.path) ?? (route.path.startsWith('/okra/') ? 1.5 : routes.indexOf(route));
}

function byPrimaryPageOrder(left: AppRoute, right: AppRoute) {
  return pageOrder(left) - pageOrder(right);
}

export const navRoutes = routes.filter((route) => route.showInNav).sort(byPrimaryPageOrder);
export const footerRoutes = routes.filter((route) => route.showInFooter).sort(byPrimaryPageOrder);
export const legalFooterRoutes = routes.filter((route) => route.showInLegalFooter);
export const prerenderRoutes = routes.filter((route) => route.prerender);

export const goodRootsNetworkUrl = import.meta.env.VITE_GRN_URL || 'https://grn.oliviasgarden.org';
export const adminUrl = import.meta.env.VITE_ADMIN_URL || 'https://admin.oliviasgarden.org';
export const instagramUrl = 'https://instagram.com/oliviasgardentx';
export const facebookUrl = 'https://www.facebook.com/profile.php?id=100087146659606#';
export const candidProfileUrl = 'https://app.candid.org/profile/16182978/olivias-garden-foundation/?pkId=35b25f41-ab7c-4561-8c50-493d5bbb7532&isActive=true';
export const candidSealImageUrl = 'https://widgets.guidestar.org/prod/v1/pdp/transparency-seal/16182978/svg';
export const siteUrl = (import.meta.env.VITE_SITE_URL ?? 'https://oliviasgarden.org').replace(/\/+$/, '');
export const webApiBase = (import.meta.env.VITE_WEB_API_BASE ?? '/api/web').replace(/\/+$/, '');
export const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY?.trim() ?? '';

export function getRouteByPath(pathname: string) {
  return routes.find((route) => route.path === pathname) ?? notFoundRoute;
}
