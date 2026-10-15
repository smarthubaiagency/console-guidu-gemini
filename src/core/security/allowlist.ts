import { isIP } from "node:net";

import { normalizeIp } from "./client-ip";

/**
 * Entries of an IP allow list (CF5a), as typed in the form: one address or
 * CIDR block per line (commas and spaces also separate). Pure: the database
 * stores them as `cidr[]` and normalizes host bits (`10.1.2.3/8` becomes
 * `10.0.0.0/8`); this only decides what may reach it.
 */

export const MAX_ALLOWLIST_ENTRIES = 50;

export type ParsedAllowlist =
  | Readonly<{ ok: true; entries: string[] }>
  | Readonly<{ ok: false; reason: "invalid"; invalid: string[] }>
  | Readonly<{ ok: false; reason: "too_many" }>;

/** One entry as `address/prefix`, or null when it is not valid. */
export function parseCidr(raw: string): string | null {
  const [address, prefix, ...rest] = raw.trim().split("/");
  if (rest.length > 0 || !address) return null;
  const ip = normalizeIp(address);
  if (!ip || ip !== address.toLowerCase()) return null;
  const max = isIP(ip) === 4 ? 32 : 128;
  if (prefix === undefined) return `${ip}/${max}`;
  if (!/^\d{1,3}$/.test(prefix)) return null;
  const bits = Number(prefix);
  return bits <= max ? `${ip}/${bits}` : null;
}

export function parseAllowlist(text: string): ParsedAllowlist {
  const raw = text
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const invalid = raw.filter((entry) => parseCidr(entry) === null);
  if (invalid.length > 0) {
    return { ok: false, reason: "invalid", invalid: invalid.slice(0, 5) };
  }
  const entries = [...new Set(raw.map((entry) => parseCidr(entry)!))];
  if (entries.length > MAX_ALLOWLIST_ENTRIES) {
    return { ok: false, reason: "too_many" };
  }
  return { ok: true, entries };
}
