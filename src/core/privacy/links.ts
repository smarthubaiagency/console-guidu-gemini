import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

import { getMasterKeyConfig } from "@/core/credentials/crypto";

/**
 * Short download links of exports (F3e, decision of 17/10/2026): valid for
 * 15 minutes and only for the export and the person they were made for.
 * The route still checks the session, the permission and the export's own
 * expiry; the link only keeps a copied URL from living on. The key is
 * derived from the master key, so no new secret exists.
 */
export const EXPORT_LINK_TTL_MS = 15 * 60_000;

function linkKey(): Buffer {
  const { key } = getMasterKeyConfig();
  return Buffer.from(
    hkdfSync("sha256", key, Buffer.alloc(0), "guidu/export-link/v1", 32),
  );
}

function signature(exportId: string, userId: string, expires: number) {
  return createHmac("sha256", linkKey())
    .update(`${exportId}.${userId}.${expires}`)
    .digest("base64url");
}

export function signExportLink(
  exportId: string,
  userId: string,
  now: number = Date.now(),
): { expires: number; signature: string } {
  const expires = now + EXPORT_LINK_TTL_MS;
  return { expires, signature: signature(exportId, userId, expires) };
}

export function verifyExportLink(
  exportId: string,
  userId: string,
  expires: number,
  given: string,
  now: number = Date.now(),
): boolean {
  if (!Number.isSafeInteger(expires) || expires < now) return false;
  if (expires > now + EXPORT_LINK_TTL_MS) return false;
  const expected = Buffer.from(signature(exportId, userId, expires));
  const actual = Buffer.from(given);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Download path of an export with a fresh short link. */
export function exportDownloadHref(
  workspaceSlug: string,
  exportId: string,
  userId: string,
): string {
  const { expires, signature } = signExportLink(exportId, userId);
  const params = new URLSearchParams({ expires: String(expires), signature });
  return `/app/${encodeURIComponent(workspaceSlug)}/settings/data/exports/${exportId}?${params}`;
}
