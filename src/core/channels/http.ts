import "server-only";

import { lookup as lookupCallback, type LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";

/**
 * Calls from the server to a provider whose address the customer typed
 * (Chatwoot is self-hosted): HTTPS only, never to a private, loopback or
 * link-local address, with a time limit and a bounded answer. Local tests
 * and the e2e rig talk to a fake provider on 127.0.0.1 with
 * `GUIDU_CHANNELS_ALLOW_PRIVATE=true`, refused in production.
 *
 * The address is checked twice: before the call, and again by the lookup
 * of the socket itself (`pinnedFetch`), so the connection goes only to an
 * address that passed the check (no DNS rebinding between the two, A5c).
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
 * DNS lookup of the socket: resolves the host and refuses a non-public
 * address, so the connection is made only to an address that was checked.
 */
export const publicLookup: LookupFunction = (hostname, options, callback) => {
  lookupCallback(hostname, { ...options, all: true }, (error, addresses) => {
    const done = callback as (
      error: NodeJS.ErrnoException | null,
      address: string | LookupAddress[],
      family?: number,
    ) => void;
    if (error) return done(error, "", 0);
    const list = addresses as unknown as LookupAddress[];
    if (
      list.length === 0 ||
      (!allowPrivate() && list.some((a) => isPrivateAddress(a.address)))
    ) {
      return done(new ChannelHttpError("private_address"), "", 0);
    }
    const first = list[0]!;
    if (options.all) return done(null, list);
    return done(null, first.address, first.family);
  });
};

/**
 * `fetch` over Node's http(s) with `publicLookup`: TLS still checks the
 * host's certificate, redirects are never followed and only a text body is
 * sent (the provider's JSON).
 */
export const pinnedFetch = ((input: string | URL | Request, init = {}) =>
  new Promise<Response>((resolve, reject) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const body = init.body ?? null;
    if (body !== null && typeof body !== "string") {
      reject(new TypeError("pinnedFetch only sends text bodies"));
      return;
    }
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = send(
      url,
      {
        method: init.method ?? "GET",
        headers: Object.fromEntries(new Headers(init.headers)),
        lookup: publicLookup,
        ...(init.signal ? { signal: init.signal } : {}),
      },
      (incoming) => {
        const status = incoming.statusCode ?? 0;
        if (status < 200 || status > 599) {
          incoming.resume();
          reject(new ChannelHttpError("invalid_response", status));
          return;
        }
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (value === undefined) continue;
          for (const item of Array.isArray(value) ? value : [value]) {
            headers.append(name, item);
          }
        }
        const empty =
          status === 204 || status === 304 || init.method === "HEAD";
        if (empty) incoming.resume();
        resolve(
          new Response(
            empty ? null : (Readable.toWeb(incoming) as ReadableStream),
            { status, headers },
          ),
        );
      },
    );
    request.on("error", (error) => {
      const reason = init.signal?.aborted ? init.signal.reason : null;
      reject(reason instanceof Error ? reason : error);
    });
    if (body !== null) request.write(body);
    request.end();
  })) as ChannelFetch;

function transportError(error: unknown): ChannelHttpError {
  if (error instanceof ChannelHttpError) return error;
  return new ChannelHttpError(
    error instanceof Error && error.name === "TimeoutError"
      ? "timeout"
      : "network",
  );
}

function statusError(response: Response): ChannelHttpError | null {
  if (response.status === 401 || response.status === 403) {
    return new ChannelHttpError("unauthorized", response.status);
  }
  if (response.status === 404) {
    return new ChannelHttpError("not_found", response.status);
  }
  if (!response.ok) return new ChannelHttpError("http_error", response.status);
  return null;
}

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
    response = await (deps.fetch ?? pinnedFetch)(target, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    throw transportError(error);
  }
  const failed = statusError(response);
  if (failed) {
    await response.body?.cancel().catch(() => undefined);
    throw failed;
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
  return (await readLimitedBytes(source, limit)).toString("utf8");
}

/** The same, as bytes (a file of a message). */
export async function readLimitedBytes(
  source: Response | Request,
  limit: number,
): Promise<Buffer> {
  const declared = Number(source.headers.get("content-length") ?? "0");
  if (declared > limit) {
    await source.body?.cancel().catch(() => undefined);
    throw new ChannelHttpError("too_large");
  }
  if (!source.body) return Buffer.alloc(0);
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
  return Buffer.concat(chunks);
}

const MAX_REDIRECTS = 3;

/**
 * Downloads a file a contact sent (A5c). The first address must be on the
 * provider's origin; the provider may redirect to its storage (S3 and
 * alike), and every hop is checked again (https, public address). No
 * header is sent: the provider's file links are signed.
 */
export async function providerDownload(
  url: string,
  providerBase: string,
  deps: Readonly<{
    fetch?: ChannelFetch;
    timeoutMs?: number;
    maxBytes: number;
  }>,
): Promise<Readonly<{ data: Buffer; mediaType: string | null }>> {
  let target = new URL(url);
  if (target.origin !== providerOrigin(providerBase)) {
    throw new ChannelHttpError("invalid_url");
  }
  const signal = AbortSignal.timeout(deps.timeoutMs ?? 30_000);
  for (let hop = 0; ; hop += 1) {
    providerOrigin(target.origin);
    await assertPublicHost(target);
    let response: Response;
    try {
      response = await (deps.fetch ?? pinnedFetch)(target, {
        method: "GET",
        redirect: "manual",
        signal,
      });
    } catch (error) {
      throw transportError(error);
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      const location = response.headers.get("location");
      if (!location || hop >= MAX_REDIRECTS) {
        throw new ChannelHttpError("http_error", response.status);
      }
      target = new URL(location, target);
      continue;
    }
    const failed = statusError(response);
    if (failed) {
      await response.body?.cancel().catch(() => undefined);
      throw failed;
    }
    const mediaType =
      response.headers.get("content-type")?.split(";")[0]?.trim() || null;
    return {
      data: await readLimitedBytes(response, deps.maxBytes),
      mediaType,
    };
  }
}
