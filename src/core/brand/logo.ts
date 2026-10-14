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

/**
 * Images of the brand (CF2). The dark logo and the share image take the
 * logo's formats; the favicon takes a square PNG or an ICO.
 */
export type BrandImageKind = "logo" | "logoDark" | "favicon" | "shareImage";

export type BrandImageMime = LogoMime | "image/x-icon";

export const BRAND_IMAGE_MAX_BYTES: Readonly<Record<BrandImageKind, number>> = {
  logo: MAX_LOGO_BYTES,
  logoDark: MAX_LOGO_BYTES,
  favicon: 64 * 1024,
  shareImage: 512 * 1024,
};

const ICO = [0x00, 0x00, 0x01, 0x00];

/** Width and height of a PNG from its IHDR chunk, or null. */
export function pngSize(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (bytes.length < 24 || !startsWith(bytes, PNG)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export type BrandImageCheck =
  | { ok: true; mime: BrandImageMime }
  | {
      ok: false;
      reason: "empty" | "too_large" | "unsupported_type" | "not_square";
    };

export function checkBrandImage(
  kind: BrandImageKind,
  bytes: Uint8Array,
): BrandImageCheck {
  if (bytes.length === 0) return { ok: false, reason: "empty" };
  if (bytes.length > BRAND_IMAGE_MAX_BYTES[kind]) {
    return { ok: false, reason: "too_large" };
  }
  if (kind !== "favicon") {
    const mime = detectLogoMime(bytes);
    return mime
      ? { ok: true, mime }
      : { ok: false, reason: "unsupported_type" };
  }
  // ICO header: reserved 0, type 1, then the first image's width and height
  // (0 means 256).
  if (bytes.length >= 8 && startsWith(bytes, ICO)) {
    return bytes[6] === bytes[7]
      ? { ok: true, mime: "image/x-icon" }
      : { ok: false, reason: "not_square" };
  }
  const size = pngSize(bytes);
  if (!size) return { ok: false, reason: "unsupported_type" };
  return size.width === size.height && size.width > 0
    ? { ok: true, mime: "image/png" }
    : { ok: false, reason: "not_square" };
}
