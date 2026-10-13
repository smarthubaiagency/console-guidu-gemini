import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Calls from the server to a provider whose address the customer typed
 * (Chatwoot is self-hosted): HTTPS only, never to a private, loopback or
 * link-local address, with a time limit and a bounded answer. Local tests
 * and the e2e rig talk to a fake provider on 127.0.0.1 with
 * `GUIDU_CHANNELS_ALLOW_PRIVATE=true`, refused in production.
 */

export class ChannelHttpError extends Error {
  constructor(
    readonly code:
      | "invalid_url"
      | "private_address"
      | "timeout"
      | "network"
      | "too_large"
      | "unauthorized"
      | "not_found"
      | "http_error"
      | "invalid_response",
    readonly status?: number,
  ) {
    super(`channel http: ${code}${status ? ` (${status})` : ""}`);
    this.name = "ChannelHttpError";
  }
}

const MAX_RESPONSE_BYTES = 2_000_000;
const DEFAULT_TIMEOUT_MS = 15_000;

function allowPrivate(): boolean {
  return (
    process.env.GUIDU_CHANNELS_ALLOW_PRIVATE === "true" &&
    process.env.NODE_ENV !== "production"
  );
}

/** Private, loopback, link-local, CGNAT and other non-public ranges. */
export function isPrivateAddress(address: string): boolean {
  const v4 = address.startsWith("::ffff:") ? address.slice(7) : address;
  if (isIP(v4) === 4) {
    const [a = 0, b = 0] = v4.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v6 = address.toLowerCase();
  return (
    v6 === "::" ||
    v6 === "::1" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") ||
    v6.startsWith("fe8") ||
    v6.startsWith("fe9") ||
    v6.startsWith("fea") ||
    v6.startsWith("feb") ||
    v6.startsWith("ff")
  );
}

/** The base address of a provider, normalized (no path, query or user). */
export function providerOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ChannelHttpError("invalid_url");
  }
  const local = allowPrivate() && url.protocol === "http:";
  if ((url.protocol !== "https:" && !local) || url.username || url.password) {
    throw new ChannelHttpError("invalid_url");
  }
  return url.origin;
}

async function assertPublicHost(url: URL): Promise<void> {
  if (allowPrivate()) return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [host]
    : (await lookup(host, { all: true }).catch(() => [])).map(
        (entry) => entry.address,
      );
  if (addresses.length === 0) throw new ChannelHttpError("network");
  if (addresses.some(isPrivateAddress)) {
    throw new ChannelHttpError("private_address");
  }
}

export type ChannelFetch = typeof fetch;

/**
 * One JSON call to a provider. The answer is read up to a limit; HTTP
 * errors become `ChannelHttpError` with the status, never the body (it may
 * echo a token).
 */
export async function providerJson(
  url: string,
  init: RequestInit,
  deps: Readonly<{ fetch?: ChannelFetch; timeoutMs?: number }> = {},
): Promise<unknown> {
  const target = new URL(url);
  providerOrigin(target.origin);
  await assertPublicHost(target);
  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(target, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ChannelHttpError(
      error instanceof Error && error.name === "TimeoutError"
        ? "timeout"
        : "network",
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new ChannelHttpError("unauthorized", response.status);
  }
  if (response.status === 404) {
    throw new ChannelHttpError("not_found", response.status);
  }
  if (!response.ok) {
    throw new ChannelHttpError("http_error", response.status);
  }
  const text = await readLimited(response, MAX_RESPONSE_BYTES);
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ChannelHttpError("invalid_response");
  }
}

/** The body of a response or request, refused past `limit` bytes. */
export async function readLimited(
  source: Response | Request,
  limit: number,
): Promise<string> {
  const declared = Number(source.headers.get("content-length") ?? "0");
  if (declared > limit) throw new ChannelHttpError("too_large");
  if (!source.body) return "";
  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new ChannelHttpError("too_large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
