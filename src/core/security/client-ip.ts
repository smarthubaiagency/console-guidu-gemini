import { isIP } from "node:net";

/**
 * Address of the visitor, for the IP allow lists (CF5a). Pure, so the rule
 * is unit tested; `docs/operacao/seguranca.md` explains how to set it up.
 *
 * Behind Traefik, `X-Forwarded-For` ends with the address of the peer that
 * reached Traefik: Traefik drops the header of untrusted peers and appends
 * the peer's address. A proxy in front of Traefik (Cloudflare) is trusted
 * by Traefik (`forwardedHeaders.trustedIPs`) and adds one more hop; then
 * `TRUSTED_PROXY_HOPS=2`. Entries left of the trusted hops are written by
 * the client and never used. Without any proxy, Next.js fills the header
 * with the socket address.
 */

export const DEFAULT_TRUSTED_PROXY_HOPS = 1;
const MAX_TRUSTED_PROXY_HOPS = 5;

/** `TRUSTED_PROXY_HOPS` from the environment: 1 to 5, else the default. */
export function trustedProxyHops(raw: string | undefined): number {
  const value = Number.parseInt(raw?.trim() ?? "", 10);
  return Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_TRUSTED_PROXY_HOPS
    ? value
    : DEFAULT_TRUSTED_PROXY_HOPS;
}

/**
 * A single address in canonical text, or null. IPv4-mapped IPv6
 * (`::ffff:203.0.113.7`) becomes IPv4; brackets, ports and IPv6 zones are
 * removed.
 */
export function normalizeIp(raw: string | null | undefined): string | null {
  let value = raw?.trim();
  if (!value || value.length > 64) return null;
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(value);
  if (bracketed) value = bracketed[1]!;
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$/.test(value)) {
    value = value.slice(0, value.lastIndexOf(":"));
  }
  value = value.replace(/%[0-9a-z._-]+$/i, "").toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (mapped) value = mapped[1]!;
  return isIP(value) === 0 ? null : value;
}

/**
 * The visitor's address: the `hops`-th entry of `X-Forwarded-For` from the
 * right (the leftmost one when the header is shorter), or null when the
 * header is missing or that entry is not an address.
 */
export function clientIp(
  get: (name: string) => string | null | undefined,
  hops: number = DEFAULT_TRUSTED_PROXY_HOPS,
): string | null {
  const entries = (get("x-forwarded-for") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) return null;
  const index = Math.max(0, entries.length - hops);
  return normalizeIp(entries[index]);
}
