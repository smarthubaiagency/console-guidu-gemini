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

/**
 * `E2E_EXTERNAL_POSTGRES=1` (the CI e2e job): a real Postgres 16 listens on
 * the database port, with user and password `postgres`, instead of PGlite.
 */
export const EXTERNAL_POSTGRES = process.env.E2E_EXTERNAL_POSTGRES === "1";

export const RIG = {
  authPort: 54399 + OFFSET,
  databasePort: 54398 + OFFSET,
  // A real Postgres (CI) gets a database of its own, dropped and created on
  // every run; PGlite (local) starts empty and serves only `postgres`.
  databaseName: EXTERNAL_POSTGRES ? "guidu_e2e" : "postgres",
  chatwootPort: 54397 + OFFSET,
  resendPort: 54396 + OFFSET,
  // Google Translate double (TR2).
  translatePort: 54395 + OFFSET,
  appPort: APP_PORT,
  // `localhost` matches the host Next.js dev serves from, so its cross-origin
  // guard for dev resources stays quiet.
  appUrl: `http://localhost:${APP_PORT}`,
  publishableKey: "e2e-publishable-key",
  // Seal of the Event Hub (H1): the web, the worker and the rig's seeding
  // of events share it.
  eventsHmacKey:
    process.env.EVENTS_HMAC_KEY || "e2e-events-hmac-key-0123456789abcdef0123",
  eventsHmacKeyId: process.env.EVENTS_HMAC_KEY_ID || "k1",
} as const;

export const AUTH_BASE_URL = `http://127.0.0.1:${RIG.authPort}`;
// pgbouncer=true: no named prepared statements. PGlite serves a single
// session shared by the web server and the job worker (F3a), where named
// statements of two Prisma clients would collide.
export const DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${RIG.databasePort}/${RIG.databaseName}?connection_limit=5&pgbouncer=true`;
