/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  /** "true" in a demo build; absent otherwise. See lib/demoMode.ts. */
  readonly VITE_DEMO?: string;
  /** Short git SHA, baked in by vite.config.ts. */
  readonly VITE_APP_VERSION?: string;
  /** ISO timestamp of the build, baked in by vite.config.ts. */
  readonly VITE_BUILD_TIME?: string;
  readonly VITE_RECAPTCHA_SITE_KEY: string;
  readonly VITE_ENABLE_PUBLISHER_FEEDS: string;
  readonly VITE_APP_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
