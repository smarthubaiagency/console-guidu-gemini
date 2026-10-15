/**
 * Maintenance window of the platform (CF5c), the pure part: what a window
 * means at a given moment, which requests it reaches and how a form's
 * local date becomes an instant. No database and no request here, so the
 * web, the worker and the unit tests share it.
 *
 * - `maintenance`: /app and /admin show the maintenance page, the public
 *   API answers 503 with Retry-After, jobs wait in the queue.
 * - `read_only`: pages and reads go on; server actions of /app and /admin
 *   and writing API calls are refused; jobs wait in the queue.
 * - /platform, its API and MCP, health checks, auth callbacks, the
 *   ForwardAuth of the custom domains and the webhooks of the channels are
 *   never closed (`MAINTENANCE_OPEN_ROUTES`).
 */

export const MAINTENANCE_MODES = ["maintenance", "read_only"] as const;
export type MaintenanceMode = (typeof MAINTENANCE_MODES)[number];

export const MAINTENANCE_LOCALES = ["pt-BR", "en", "es"] as const;
export type MaintenanceLocale = (typeof MAINTENANCE_LOCALES)[number];

export type MaintenanceMessages = Readonly<
  Partial<Record<MaintenanceLocale, string>>
>;

/** A window that is on and not over (`private.maintenance_state()`). */
export type MaintenanceWindow = Readonly<{
  mode: MaintenanceMode;
  startsAt: Date | null;
  endsAt: Date | null;
  messages: MaintenanceMessages;
}>;

export type MaintenanceStatus =
  | Readonly<{ phase: "off" }>
  | Readonly<{
      phase: "scheduled";
      window: MaintenanceWindow;
      /** Inside the notice period before the start: show the strip. */
      notice: boolean;
    }>
  | Readonly<{ phase: "active"; window: MaintenanceWindow }>;

/** The notice strip appears this long before a scheduled start. */
export const NOTICE_LEAD_MS = 24 * 60 * 60 * 1000;
/** Retry-After when the window has no end. */
export const DEFAULT_RETRY_AFTER_SECONDS = 600;
const MIN_RETRY_AFTER_SECONDS = 30;
/**
 * Time zone of the form's dates: the display zone of the dashboard
 * (src/i18n/request.ts), so what the admin types is what everybody reads.
 */
export const MAINTENANCE_TIME_ZONE = "America/Sao_Paulo";
/** Longest message per language. */
export const MAX_MESSAGE_LENGTH = 500;

export function isMaintenanceMode(value: unknown): value is MaintenanceMode {
  return (MAINTENANCE_MODES as readonly unknown[]).includes(value);
}

/** What the window means at `now`. */
export function evaluateMaintenance(
  window: MaintenanceWindow | null,
  now: Date,
): MaintenanceStatus {
  if (!window) return { phase: "off" };
  const time = now.getTime();
  if (window.endsAt && window.endsAt.getTime() <= time) return { phase: "off" };
  if (window.startsAt && window.startsAt.getTime() > time) {
    return {
      phase: "scheduled",
      window,
      notice: window.startsAt.getTime() - time <= NOTICE_LEAD_MS,
    };
  }
  return { phase: "active", window };
}

/** The window in force, or null. */
export function activeMode(status: MaintenanceStatus): MaintenanceMode | null {
  return status.phase === "active" ? status.window.mode : null;
}

/** Seconds for Retry-After: until the end, or a default without one. */
export function retryAfterSeconds(
  status: MaintenanceStatus,
  now: Date,
): number {
  if (status.phase !== "active" || !status.window.endsAt) {
    return DEFAULT_RETRY_AFTER_SECONDS;
  }
  const seconds = Math.ceil(
    (status.window.endsAt.getTime() - now.getTime()) / 1000,
  );
  return Math.max(MIN_RETRY_AFTER_SECONDS, seconds);
}

/** The message in the language, else in Portuguese, else none. */
export function maintenanceMessage(
  messages: MaintenanceMessages,
  locale: string,
): string | null {
  const own = messages[locale as MaintenanceLocale]?.trim();
  if (own) return own;
  return messages["pt-BR"]?.trim() || null;
}

// ---------------------------------------------------------------------------
// Areas
// ---------------------------------------------------------------------------

/**
 * Areas a window closes (pages and server actions): the workspaces, the
 * partner console and the invitation acceptance. `/app/account/security`
 * stays open: whoever has no second factor yet enrols there, and the
 * platform admins need it to reach /platform during the window.
 */
const CLOSED_PREFIXES = ["/app", "/admin", "/invite", "/partner-invite"];
const OPEN_PREFIXES = ["/app/account/security"];

function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Whether a window closes the page or action at this path. */
export function isClosedPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  if (OPEN_PREFIXES.some((prefix) => under(pathname, prefix))) return false;
  return CLOSED_PREFIXES.some((prefix) => under(pathname, prefix));
}

/**
 * Routes that stay open in both modes, and why (also shown in Operações ›
 * Manutenção). Everything under /app, /admin and the public API not listed
 * here is closed.
 */
export const MAINTENANCE_OPEN_ROUTES = [
  "/platform",
  "/api/v1/platform",
  "/mcp/platform",
  "/login",
  "/auth",
  "/forgot-password",
  "/reset-password",
  "/app/account/security",
  "/maintenance",
  "/legal",
  "/brand",
  "/api/health",
  "/api/domains/check",
  "/api/channels",
] as const;

/** HTTP methods that only read. */
export function isReadMethod(method: string): boolean {
  return ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

/**
 * What a window does to a request of the public API or of the workspace
 * MCP: `closed` (503 for all), `read_only` (503 for writes) or null.
 */
export function apiRefusal(
  status: MaintenanceStatus,
  method: string,
): "maintenance" | "read_only" | null {
  const mode = activeMode(status);
  if (mode === "maintenance") return "maintenance";
  if (mode === "read_only" && !isReadMethod(method)) return "read_only";
  return null;
}

// ---------------------------------------------------------------------------
// Dates of the form
// ---------------------------------------------------------------------------

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** Offset of the time zone at an instant, in milliseconds. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Instant of a `datetime-local` value (`2026-11-20T23:00`) read in the time
 * zone; null for an empty or invalid value.
 */
export function zonedLocalToDate(value: string, timeZone: string): Date | null {
  const match = LOCAL_DATE_TIME.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(wall);
  if (check.getUTCDate() !== d || check.getUTCMonth() !== mo - 1) return null;
  // Two passes settle the offset around a change of daylight saving time.
  let instant = wall - zoneOffsetMs(new Date(wall), timeZone);
  instant = wall - zoneOffsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

/** `datetime-local` value of an instant in the time zone. */
export function dateToZonedLocal(date: Date, timeZone: string): string {
  const local = new Date(date.getTime() + zoneOffsetMs(date, timeZone));
  return local.toISOString().slice(0, 16);
}
