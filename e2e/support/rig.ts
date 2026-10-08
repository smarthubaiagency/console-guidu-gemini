/**
 * Fixed endpoints of the end-to-end rig. The Playwright config and the global
 * setup both read them, so the dev server and the harness cannot drift apart.
 */
export const RIG = {
  authPort: 54399,
  databasePort: 54398,
  // `localhost` matches the host Next.js dev serves from, so its cross-origin
  // guard for dev resources stays quiet.
  appUrl: "http://localhost:3000",
  publishableKey: "e2e-publishable-key",
} as const;

export const AUTH_BASE_URL = `http://127.0.0.1:${RIG.authPort}`;
export const DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${RIG.databasePort}/postgres?connection_limit=5`;
