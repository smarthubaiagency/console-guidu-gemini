import { describe, expect, it } from "vitest";

import { MAX_LOGO_BYTES, checkLogo, detectLogoMime } from "./logo";

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
