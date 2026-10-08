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
import { AUTH_BASE_URL, DATABASE_URL, RIG } from "./e2e/support/rig";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/support/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: RIG.appUrl,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: RIG.appUrl,
    reuseExistingServer: false,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: AUTH_BASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: RIG.publishableKey,
      SUPABASE_URL: AUTH_BASE_URL,
      SUPABASE_ANON_KEY: RIG.publishableKey,
      DATABASE_URL: DATABASE_URL,
      DIRECT_DATABASE_URL: DATABASE_URL,
      SUPABASE_JWT_SECRET: "e2e-fake-gotrue-secret",
    },
  },
});
