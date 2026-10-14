import { describe, expect, it } from "vitest";

import { directFileUrl, isWebPage, outboundFilename } from "./outbound";

/** Files the agent sends (A5d): Google links and file names. */

describe("directFileUrl", () => {
  it("turns Google Drive and Docs links into the file", () => {
    expect(
      directFileUrl(
        "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing",
      ),
    ).toBe("https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOp");
    expect(
      directFileUrl("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp"),
    ).toBe("https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOp");
    expect(
      directFileUrl(
        "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit#gid=0",
      ),
    ).toBe(
      "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/export?format=pdf",
    );
  });

  it("keeps any other address", () => {
    expect(directFileUrl("https://cdn.example.com/catalogo.pdf")).toBe(
      "https://cdn.example.com/catalogo.pdf",
    );
  });
});

describe("outboundFilename", () => {
  it("uses the address's own name, or the caption with the type", () => {
    expect(
      outboundFilename(
        "https://cdn.example.com/files/catalogo%202026.pdf",
        "Catálogo",
        "application/pdf",
      ),
    ).toBe("catalogo 2026.pdf");
    expect(
      outboundFilename(
        "https://drive.google.com/uc?export=download&id=1",
        "Tabela de preços",
        "application/pdf",
      ),
    ).toBe("Tabela de pre_os.pdf");
    expect(
      outboundFilename("https://x.example.com/img", null, "image/png"),
    ).toBe("arquivo.png");
  });
});

describe("isWebPage", () => {
  it("tells a page from a file", () => {
    expect(isWebPage("text/html")).toBe(true);
    expect(isWebPage("application/pdf")).toBe(false);
    expect(isWebPage(null)).toBe(false);
  });
});
