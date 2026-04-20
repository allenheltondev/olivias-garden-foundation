interface ImportMetaEnv {
  readonly VITE_AUTH_USER_POOL_ID?: string;
  readonly VITE_AUTH_USER_POOL_CLIENT_ID?: string;
  readonly VITE_AUTH_USER_POOL_DOMAIN?: string;
  readonly VITE_GRN_URL?: string;
  readonly VITE_SITE_URL?: string;
  readonly VITE_STRIPE_PUBLISHABLE_KEY?: string;
  readonly VITE_WEB_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
