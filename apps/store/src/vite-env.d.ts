/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_USER_POOL_ID: string;
  readonly VITE_USER_POOL_CLIENT_ID: string;
  readonly VITE_AWS_REGION?: string;
  readonly VITE_STORE_API_URL: string;
  readonly VITE_FOUNDATION_URL?: string;
  readonly VITE_GRN_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
