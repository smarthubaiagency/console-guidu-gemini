/**
 * ============================================================================
 * File: playwright.config.ts
 * Module: Playwright End-to-End Suite Configuration
 *
 * Maintenance Rationale:
 * - Bootstraps the local test rig (PGlite test database + fake GoTrue auth double).
 * - Serves Next.js under dedicated test environment variables.
 * - Isolates e2e test execution from remote hosted databases and third-party dependencies.
 * ============================================================================
 */

import { defineConfig, devices } from "@playwright/test";
import { FAKE_RESEND_KEY } from "./e2e/support/fake-resend";
import { AUTH_BASE_URL, DATABASE_URL, RIG } from "./e2e/support/rig";

export default defineConfig({
  testMatch: ["e2e/**/*.spec.ts", "tests/e2e/**/*.spec.ts"],
  globalSetup: "./e2e/support/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: RIG.appUrl,
    // Visitors without a session get the browser language (I1); the suite
    // plays a Brazilian user, so the browser speaks pt-BR.
    locale: "pt-BR",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: RIG.appUrl,
    reuseExistingServer: false,
    env: {
      PORT: String(RIG.appPort),
      NEXT_PUBLIC_SUPABASE_URL: AUTH_BASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: RIG.publishableKey,
      SUPABASE_URL: AUTH_BASE_URL,
      SUPABASE_ANON_KEY: RIG.publishableKey,
      DATABASE_URL: DATABASE_URL,
      DIRECT_DATABASE_URL: DATABASE_URL,
      SUPABASE_JWT_SECRET: "e2e-fake-gotrue-secret",
      ENCRYPTION_KEY:
        process.env.ENCRYPTION_KEY ||
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      ENCRYPTION_KEY_ID: process.env.ENCRYPTION_KEY_ID || "k1",
      // Reference module is restricted to development and tests (Adendo §9).
      GUIDU_MODULE_HELLO_WORLD_ENABLED: "true",
      // Deterministic machine translation (I6); never the real provider.
      TRANSLATION_PROVIDER: "fake",
      // Google OAuth (CF6b): the consent answers at once, nothing leaves.
      GOOGLE_OAUTH_PROVIDER: "fake",
      // Agent GMN (GB1b): fake maps provider and fake AI suggestions.
      MAPS_INTELLIGENCE_PROVIDER: "fake",
      GB_SUGGESTIONS_PROVIDER: "fake",
      // Google Meu Negócio (GB1a): the module on, the fake provider with its
      // consent page and the fixed answer of the specialist; never Zernio.
      GUIDU_MODULE_GOOGLE_BUSINESS_ENABLED: "true",
      GOOGLE_BUSINESS_PROVIDER: "fake",
      GOOGLE_BUSINESS_SPECIALIST_PROVIDER: "fake",
      // The Chatwoot double of the rig listens on 127.0.0.1 over http (A5a).
      GUIDU_CHANNELS_ALLOW_PRIVATE: "true",
      // Custom domains (CF2b): the CNAME target shown in the instructions and
      // the ForwardAuth secret; Cloudflare stays off, so DNS alone decides.
      CUSTOM_DOMAIN_CNAME_TARGET: "proxy.guidu.test",
      DOMAINS_CHECK_SECRET: "e2e-domains-check-secret",
      // E-mail (CF3a) goes to the Resend double of the rig.
      RESEND_API_KEY: FAKE_RESEND_KEY,
      RESEND_API_BASE: `http://127.0.0.1:${RIG.resendPort}`,
      EMAIL_FROM_ADDRESS: "avisos@guidu.test",
      // Login methods (CF5b): Google's provider counts as on and the link's
      // as off, so e2e/auth-settings.spec.ts covers both halves of the rule.
      // Neither button shows until the platform offers it.
      AUTH_GOOGLE_ENABLED: "true",
      APP_NAME: process.env.APP_NAME || "GUIDU",
      APP_URL: process.env.APP_URL || RIG.appUrl,
    },
  },
});
