import { describe, expect, it } from "vitest";

import {
  BRAND_IMAGE_MAX_BYTES,
  MAX_LOGO_BYTES,
  checkBrandImage,
  checkLogo,
  detectLogoMime,
  pngSize,
} from "./logo";

const png = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0,
]);
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0]);
const webp = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0,
]);
const svg = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);

describe("detectLogoMime", () => {
  it("identifies PNG, JPEG and WebP by signature", () => {
    expect(detectLogoMime(png)).toBe("image/png");
    expect(detectLogoMime(jpeg)).toBe("image/jpeg");
    expect(detectLogoMime(webp)).toBe("image/webp");
  });

  it("refuses SVG and unknown content", () => {
    expect(detectLogoMime(svg)).toBeNull();
    expect(detectLogoMime(new TextEncoder().encode("GIF89a"))).toBeNull();
  });
});

describe("checkLogo", () => {
  it("enforces the size limit and the type", () => {
    expect(checkLogo(new Uint8Array())).toEqual({ ok: false, reason: "empty" });
    const big = new Uint8Array(MAX_LOGO_BYTES + 1);
    big.set(png);
    expect(checkLogo(big)).toEqual({ ok: false, reason: "too_large" });
    expect(checkLogo(svg)).toEqual({ ok: false, reason: "unsupported_type" });
    expect(checkLogo(png)).toEqual({ ok: true, mime: "image/png" });
  });
});

/** PNG header with an IHDR of the given size. */
function pngOf(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

describe("checkBrandImage (CF2)", () => {
  it("reads the PNG size from IHDR", () => {
    expect(pngSize(pngOf(32, 16))).toEqual({ width: 32, height: 16 });
    expect(pngSize(jpeg)).toBeNull();
  });

  it("takes a square PNG or an ICO as favicon", () => {
    expect(checkBrandImage("favicon", pngOf(32, 32))).toEqual({
      ok: true,
      mime: "image/png",
    });
    expect(checkBrandImage("favicon", pngOf(64, 32))).toEqual({
      ok: false,
      reason: "not_square",
    });
    expect(
      checkBrandImage("favicon", Uint8Array.from([0, 0, 1, 0, 1, 0, 16, 16])),
    ).toEqual({ ok: true, mime: "image/x-icon" });
    expect(checkBrandImage("favicon", jpeg)).toEqual({
      ok: false,
      reason: "unsupported_type",
    });
    expect(checkBrandImage("favicon", svg)).toEqual({
      ok: false,
      reason: "unsupported_type",
    });
  });

  it("applies the size limit of each image", () => {
    const share = new Uint8Array(BRAND_IMAGE_MAX_BYTES.shareImage);
    share.set(png);
    expect(checkBrandImage("shareImage", share)).toEqual({
      ok: true,
      mime: "image/png",
    });
    const favicon = new Uint8Array(BRAND_IMAGE_MAX_BYTES.favicon + 1);
    favicon.set(pngOf(16, 16));
    expect(checkBrandImage("favicon", favicon)).toEqual({
      ok: false,
      reason: "too_large",
    });
    expect(checkBrandImage("logoDark", svg)).toEqual({
      ok: false,
      reason: "unsupported_type",
    });
  });
});
