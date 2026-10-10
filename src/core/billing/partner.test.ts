import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { detectEvidenceMime, isValidCnpj } from "./partner";

describe("billing profile", () => {
  it("validates CNPJ check digits", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11222333000181")).toBe(true);
    expect(isValidCnpj("11222333000182")).toBe(false);
    expect(isValidCnpj("00000000000000")).toBe(false);
    expect(isValidCnpj("1122233300018")).toBe(false);
  });
});

describe("payment evidence", () => {
  it("accepts PDF and the image types by their real bytes", () => {
    expect(detectEvidenceMime(new TextEncoder().encode("%PDF-1.7\n"))).toBe(
      "application/pdf",
    );
    expect(
      detectEvidenceMime(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe("image/png");
  });

  it("rejects anything else, whatever the name says", () => {
    expect(
      detectEvidenceMime(new TextEncoder().encode("<svg onload=x>")),
    ).toBeNull();
    expect(detectEvidenceMime(new Uint8Array([0x4d, 0x5a]))).toBeNull();
  });
});
