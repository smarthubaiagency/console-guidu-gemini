import { createPrivateKey, type KeyObject } from "node:crypto";

/**
 * Configuration of the Matrix core (IN3, ADR 0023). Read from the
 * environment, with the names written by `scripts/matrix/setup.ts`; the
 * console and the worker read the same variables. When any required one is
 * missing, Matrix is off: no route answers, no job runs, nothing is asked
 * of Synapse. The `server_name` always comes from the environment (the test
 * server, dev and production each have their own, fixed at creation).
 */

export type MatrixConfig = Readonly<{
  /** Client-Server base URL, without the trailing slash. */
  homeserverUrl: string;
  /** Origin of the homeserver, for the CSP `connect-src`. */
  homeserverOrigin: string;
  serverName: string;
  asId: string;
  /** Localpart of the Application Service sender (`_guidu_core`). */
  asSender: string;
  asToken: string;
  hsToken: string;
  jwtIssuer: string;
  jwtAudience: string;
  jwtPrivateKey: KeyObject;
}>;

const REQUIRED = [
  "MATRIX_HOMESERVER_URL",
  "MATRIX_SERVER_NAME",
  "MATRIX_AS_TOKEN",
  "MATRIX_HS_TOKEN",
  "MATRIX_JWT_PRIVATE_KEY",
] as const;

type Env = Readonly<Record<string, string | undefined>>;

/** PEM text, raw or base64 on one line (as setup.ts writes it). */
export function parsePrivateKey(value: string): KeyObject {
  const trimmed = value.trim();
  const pem = trimmed.includes("-----BEGIN")
    ? trimmed.replace(/\\n/g, "\n")
    : Buffer.from(trimmed, "base64").toString("utf8");
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== "rsa") {
    throw new Error("MATRIX_JWT_PRIVATE_KEY must be an RSA key (RS256).");
  }
  return key;
}

function homeserver(raw: string): { url: string; origin: string } | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return {
      url: `${url.origin}${url.pathname}`.replace(/\/+$/, ""),
      origin: url.origin,
    };
  } catch {
    return null;
  }
}

let cached: { env: Env; key: string; value: MatrixConfig | null } | null = null;

/** The configuration, or null when Matrix is off (or misconfigured). */
export function matrixConfig(env: Env = process.env): MatrixConfig | null {
  const key = [
    ...REQUIRED,
    "MATRIX_AS_ID",
    "MATRIX_AS_SENDER",
    "MATRIX_JWT_ISSUER",
    "MATRIX_JWT_AUDIENCE",
  ]
    .map((name) => env[name] ?? "")
    .join("\u0000");
  if (cached && cached.env === env && cached.key === key) return cached.value;
  const value = readConfig(env);
  cached = { env, key, value };
  return value;
}

function readConfig(env: Env): MatrixConfig | null {
  if (REQUIRED.some((name) => !env[name]?.trim())) return null;
  const server = homeserver(env.MATRIX_HOMESERVER_URL!.trim());
  const serverName = env.MATRIX_SERVER_NAME!.trim();
  if (!server || !/^[a-z0-9.-]+(:\d+)?$/i.test(serverName)) {
    console.error(
      "[matrix] MATRIX_HOMESERVER_URL or MATRIX_SERVER_NAME is invalid; Matrix stays off.",
    );
    return null;
  }
  let jwtPrivateKey: KeyObject;
  try {
    jwtPrivateKey = parsePrivateKey(env.MATRIX_JWT_PRIVATE_KEY!);
  } catch {
    console.error(
      "[matrix] MATRIX_JWT_PRIVATE_KEY is not an RSA private key; Matrix stays off.",
    );
    return null;
  }
  const asSender = env.MATRIX_AS_SENDER?.trim() || "_guidu_core";
  if (!/^_guidu_[a-z0-9._=-]+$/.test(asSender)) {
    console.error(
      "[matrix] MATRIX_AS_SENDER must be in the _guidu_ namespace; Matrix stays off.",
    );
    return null;
  }
  return Object.freeze({
    homeserverUrl: server.url,
    homeserverOrigin: server.origin,
    serverName,
    asId: env.MATRIX_AS_ID?.trim() || "guidu-core",
    asSender,
    asToken: env.MATRIX_AS_TOKEN!.trim(),
    hsToken: env.MATRIX_HS_TOKEN!.trim(),
    jwtIssuer: env.MATRIX_JWT_ISSUER?.trim() || "guidu-console",
    jwtAudience: env.MATRIX_JWT_AUDIENCE?.trim() || "guidu-matrix",
    jwtPrivateKey,
  });
}

export function matrixEnabled(env: Env = process.env): boolean {
  return matrixConfig(env) !== null;
}

/** Full user id of a localpart on this server. */
export function userId(config: MatrixConfig, localpart: string): string {
  return `@${localpart}:${config.serverName}`;
}

/** The Application Service sender, admin of Synapse (ADR 0023, rule 8). */
export function coreUserId(config: MatrixConfig): string {
  return userId(config, config.asSender);
}

/** Users of the reserved namespace of the Application Service. */
export function isNamespaceUser(config: MatrixConfig, mxid: string): boolean {
  return mxid.startsWith("@_guidu_") && mxid.endsWith(`:${config.serverName}`);
}
