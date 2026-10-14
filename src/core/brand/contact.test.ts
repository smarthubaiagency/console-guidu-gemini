import { describe, expect, it } from "vitest";

import { footerParts, whatsappHref } from "./contact";

describe("whatsappHref", () => {
  it("links to wa.me with the prefilled message", () => {
    expect(
      whatsappHref({ number: "5511999999999", label: null, message: null }),
    ).toBe("https://wa.me/5511999999999");
    expect(
      whatsappHref({
        number: "5511999999999",
        label: null,
        message: "Olá & bom dia",
      }),
    ).toBe("https://wa.me/5511999999999?text=Ol%C3%A1+%26+bom+dia");
  });
});

describe("footerParts", () => {
  it("turns only https addresses into links", () => {
    expect(
      footerParts("GUIDU Ltda. Veja https://guidu.com.br/termos. Fim"),
    ).toEqual([
      { kind: "text", value: "GUIDU Ltda. Veja " },
      { kind: "link", value: "https://guidu.com.br/termos" },
      { kind: "text", value: ". Fim" },
    ]);
    expect(footerParts("http://inseguro.com javascript:alert(1)")).toEqual([
      { kind: "text", value: "http://inseguro.com javascript:alert(1)" },
    ]);
  });

  it("keeps markup as text", () => {
    expect(footerParts("<b>oi</b>")).toEqual([
      { kind: "text", value: "<b>oi</b>" },
    ]);
  });
});
