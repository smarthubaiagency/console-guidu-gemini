/**
 * Brand logo validation (ADR 0012, P3). Only raster formats identified by
 * their file signature are accepted; the declared name or MIME type is never
 * trusted. SVG is refused because it can carry scripts.
 */

export const MAX_LOGO_BYTES = 256 * 1024;

export type LogoMime = "image/png" | "image/jpeg" | "image/webp";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];

function startsWith(
  bytes: Uint8Array,
  signature: readonly number[],
  offset = 0,
) {
  return signature.every((value, i) => bytes[offset + i] === value);
}

/** MIME type from the file signature, or null for anything else. */
export function detectLogoMime(bytes: Uint8Array): LogoMime | null {
  if (startsWith(bytes, PNG)) return "image/png";
  if (startsWith(bytes, JPEG)) return "image/jpeg";
  // RIFF....WEBP
  if (
    bytes.length >= 12 &&
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }
  return null;
}

export type LogoCheck =
  | { ok: true; mime: LogoMime }
  | { ok: false; reason: "empty" | "too_large" | "unsupported_type" };

export function checkLogo(bytes: Uint8Array): LogoCheck {
  if (bytes.length === 0) return { ok: false, reason: "empty" };
  if (bytes.length > MAX_LOGO_BYTES) return { ok: false, reason: "too_large" };
  const mime = detectLogoMime(bytes);
  return mime ? { ok: true, mime } : { ok: false, reason: "unsupported_type" };
}
