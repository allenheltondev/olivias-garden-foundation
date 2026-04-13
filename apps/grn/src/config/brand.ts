/**
 * Brand Configuration for Good Roots Network
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
    full: "Good Roots Network",
    short: "GRN",
  },
  tagline: "Local food. Grown with care",
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
      // TODO: User will provide social sharing image (1200x630px)
      // Place in apps/grn/public/images/
      ogImage: "/images/social-share.png",
      ogImageAlt: "Good Roots Network - Connecting local food growers with their communities",
    },
  },
  colors: {
    primary: "#3F7D3A",
    background: "#F7F5EF",
    themeColor: "#3F7D3A",
  },
  urls: {
    // TODO: Update with actual production domain
    canonical: "https://goodroots.network",
    domain: "goodroots.network",
  },
};
