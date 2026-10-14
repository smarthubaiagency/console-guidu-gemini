/**
 * Fixed endpoints of the end-to-end rig. The Playwright config and the global
 * setup both read them, so the dev server and the harness cannot drift apart.
 *
 * `E2E_PORT_OFFSET` shifts every port, so two checkouts of the repository can
 * run the suite at the same time on one machine (e.g. 100 gives 3100 and
 * 54496-54499). Unset, the ports are the usual ones.
 */
const OFFSET = Number(process.env.E2E_PORT_OFFSET ?? 0) || 0;
const APP_PORT = 3000 + OFFSET;

export const RIG = {
  authPort: 54399 + OFFSET,
  databasePort: 54398 + OFFSET,
  chatwootPort: 54397 + OFFSET,
  resendPort: 54396 + OFFSET,
  appPort: APP_PORT,
  // `localhost` matches the host Next.js dev serves from, so its cross-origin
  // guard for dev resources stays quiet.
  appUrl: `http://localhost:${APP_PORT}`,
  publishableKey: "e2e-publishable-key",
} as const;

export const AUTH_BASE_URL = `http://127.0.0.1:${RIG.authPort}`;
// pgbouncer=true: no named prepared statements. PGlite serves a single
// session shared by the web server and the job worker (F3a), where named
// statements of two Prisma clients would collide.
export const DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${RIG.databasePort}/postgres?connection_limit=5&pgbouncer=true`;
