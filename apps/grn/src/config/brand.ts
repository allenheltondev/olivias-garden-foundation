/**
 * Brand Configuration for the Good Roots garden planner
 *
 * This file contains all branding-related configuration including
 * names, taglines, colors, and asset paths.
 */

export interface BrandConfig {
  name: {
    full: string;
    short: string;
  };
  tagline: string;
  assets: {
    logo: {
      full: string;
      horizontal: string;
      icon: string;
      iconWhite: string;
    };
    favicon: {
      ico: string;
      png16: string;
      png32: string;
      appleTouchIcon: string;
    };
    social: {
      ogImage: string;
      ogImageAlt: string;
    };
  };
  colors: {
    primary: string;
    background: string;
    themeColor: string;
  };
  urls: {
    canonical: string;
    domain: string;
  };
}

export const brandConfig: BrandConfig = {
  name: {
    full: "Good Roots Garden Planner",
    short: "Good Roots",
  },
  tagline: "A free garden planner",
  assets: {
    logo: {
      // Using PNG logo files
      full: "/images/logo.png",
      horizontal: "/images/logo.png",
      icon: "/images/icon-192x192.png",
      iconWhite: "/images/icon-white.png",
    },
    favicon: {
      ico: "/icons/favicon.ico",
      png16: "/icons/favicon-16x16.png",
      png32: "/icons/favicon-32x32.png",
      appleTouchIcon: "/icons/apple-touch-icon.png",
    },
    social: {
      // Shares the marketing site's Good Roots social card.
      ogImage: "https://oliviasgarden.org/images/social/good-roots.png",
      ogImageAlt: "The Good Roots garden bed planner beside a garden photo, with the headline: Plan a garden you can keep up with.",
    },
  },
  colors: {
    primary: "#3F7D3A",
    background: "#F7F5EF",
    themeColor: "#3F7D3A",
  },
  urls: {
    canonical: "https://grn.oliviasgarden.org",
    domain: "grn.oliviasgarden.org",
  },
};
