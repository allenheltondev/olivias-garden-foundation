/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FOUNDATION_URL?: string;
  readonly VITE_GRN_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
