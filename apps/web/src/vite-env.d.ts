/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_ENVIRONMENT?: string;
  readonly VITE_CLOUDWATCH_RUM_APP_MONITOR_ID?: string;
  readonly VITE_CLOUDWATCH_RUM_CLIENT_URL?: string;
  readonly VITE_CLOUDWATCH_RUM_GUEST_ROLE_ARN?: string;
  readonly VITE_CLOUDWATCH_RUM_IDENTITY_POOL_ID?: string;
  readonly VITE_CLOUDWATCH_RUM_REGION?: string;
  readonly VITE_CLOUDWATCH_RUM_RELEASE_ID?: string;
  readonly VITE_INCLUDE_DRAFT_GUIDES?: string;
}

// Provided by scripts/vite-plugin-okra-guides.mjs. Typed loosely here because
// ambient module declarations can't reference relative modules; the typed
// wrappers live in src/site/okra-guides/index.ts.
declare module 'virtual:okra-guides' {
  export const okraGuideSummaries: unknown[];
  export const okraGuideRoutes: unknown[];
  export const okraGuideLoaders: Record<string, () => Promise<{ default: unknown }>>;
}
