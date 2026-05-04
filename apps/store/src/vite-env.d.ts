/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_ENVIRONMENT?: string;
  readonly VITE_USER_POOL_ID: string;
  readonly VITE_USER_POOL_CLIENT_ID: string;
  readonly VITE_AWS_REGION?: string;
  readonly VITE_STORE_API_URL: string;
  readonly VITE_FOUNDATION_URL?: string;
  readonly VITE_GRN_URL?: string;
  readonly VITE_ADMIN_URL?: string;
  readonly VITE_STORE_CLOUDWATCH_RUM_APP_MONITOR_ID?: string;
  readonly VITE_STORE_CLOUDWATCH_RUM_CLIENT_URL?: string;
  readonly VITE_STORE_CLOUDWATCH_RUM_GUEST_ROLE_ARN?: string;
  readonly VITE_STORE_CLOUDWATCH_RUM_IDENTITY_POOL_ID?: string;
  readonly VITE_STORE_CLOUDWATCH_RUM_REGION?: string;
  readonly VITE_STORE_CLOUDWATCH_RUM_RELEASE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
