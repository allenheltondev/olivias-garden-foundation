/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_ENVIRONMENT?: string;
  readonly VITE_CLOUDWATCH_RUM_APP_MONITOR_ID?: string;
  readonly VITE_CLOUDWATCH_RUM_CLIENT_URL?: string;
  readonly VITE_CLOUDWATCH_RUM_GUEST_ROLE_ARN?: string;
  readonly VITE_CLOUDWATCH_RUM_IDENTITY_POOL_ID?: string;
  readonly VITE_CLOUDWATCH_RUM_REGION?: string;
  readonly VITE_CLOUDWATCH_RUM_RELEASE_ID?: string;
}
