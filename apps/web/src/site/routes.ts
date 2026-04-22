export type AppRoute = {
  path: string;
  label: string;
  title: string;
  description: string;
  seoImage?: string;
  allowIndex?: boolean;
  showInNav?: boolean;
  showInFooter?: boolean;
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
    description: "Use one Good Roots Network account across Olivia's Garden experiences.",
    allowIndex: false,
  },
  {
    path: '/about',
    label: 'About',
    showInNav: true,
    showInFooter: true,
    title: "About Olivia's Garden",
    description: "Read Olivia's story, the foundation's mission, and the family-led work behind practical food-growing education in McKinney, Texas.",
    seoImage: socialShareImage,
    prerender: true,
  },
  {
    path: '/get-involved',
    label: 'Get Involved',
    title: 'Get involved',
    description: "Find ways to support Olivia's Garden Foundation through volunteering, seed sharing, workshops, and community participation.",
    seoImage: socialShareImage,
    prerender: true,
  },
  {
    path: '/okra',
    label: 'Okra Project',
    showInNav: true,
    showInFooter: true,
    title: 'The Okra Project',
    description: 'Explore the Okra Project map, request seeds, and follow a public invitation to grow food and share the story back.',
    seoImage: socialShareImage,
  },
  {
    path: '/impact',
    label: 'Impact',
    title: "What we're building",
    description: "See what Olivia's Garden Foundation is growing now, from garden beds and animals to the next phase of community programs.",
    seoImage: socialShareImage,
    prerender: true,
  },
  {
    path: '/donate',
    label: 'Donate',
    showInFooter: true,
    title: "Support Olivia's Garden",
    description: "Donate to Olivia's Garden Foundation through one-time gifts or Garden Club recurring support, with a permanent named garden marker for every donor.",
    seoImage: socialShareImage,
  },
  {
    path: '/profile',
    label: 'Profile',
    title: 'Your profile',
    description: "Personalize your Olivia's Garden profile and review your history of seed requests, okra submissions, and donations.",
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
];

export const navRoutes = routes.filter((route) => route.showInNav);
export const footerRoutes = routes.filter((route) => route.showInFooter);
export const prerenderRoutes = routes.filter((route) => route.prerender);
export const internalPaths = new Set(routes.map((route) => route.path));

export const goodRootsNetworkUrl = import.meta.env.VITE_GRN_URL || 'https://goodroots.network';
export const instagramUrl = 'https://instagram.com/oliviasgardentx';
export const facebookUrl = 'https://www.facebook.com/profile.php?id=100087146659606#';
export const siteUrl = (import.meta.env.VITE_SITE_URL ?? 'https://oliviasgarden.org').replace(/\/+$/, '');
export const webApiBase = (import.meta.env.VITE_WEB_API_BASE ?? '/api/web').replace(/\/+$/, '');
export const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY?.trim() ?? '';

export function getRouteByPath(pathname: string) {
  return routes.find((route) => route.path === pathname) ?? routes[0];
}
