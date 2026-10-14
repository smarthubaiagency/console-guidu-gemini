import { describe, expect, it } from "vitest";

import {
  escapeMarkup,
  fillSubject,
  isHttpUrl,
  parseMarkup,
  renderMarkupHtml,
  renderMarkupText,
  validateTemplate,
  type TemplateVariable,
} from "./markup";

const VARIABLES: TemplateVariable[] = [
  { name: "organizacao", kind: "text" },
  { name: "link", kind: "url" },
  { name: "marca", kind: "text" },
];

const html = (body: string, values: Record<string, string> = {}) =>
  renderMarkupHtml(parseMarkup(body), values);
const text = (body: string, values: Record<string, string> = {}) =>
  renderMarkupText(parseMarkup(body), values);

describe("parseMarkup and renderMarkupHtml (CF3b)", () => {
  it("renders paragraphs, breaks, headings and lists", () => {
    expect(html("Olá\nmundo\n\nFim")).toBe("<p>Olá<br>mundo</p>\n<p>Fim</p>");
    expect(html("## Título")).toBe("<h2>Título</h2>");
    expect(html("- um\n- dois")).toBe("<ul><li>um</li><li>dois</li></ul>");
    expect(html("1. um\n2. dois")).toBe("<ol><li>um</li><li>dois</li></ol>");
  });

  it("renders bold, italic and nested emphasis", () => {
    expect(html("**forte** e *leve*")).toBe(
      "<p><strong>forte</strong> e <em>leve</em></p>",
    );
    expect(html("*a **b** c*")).toBe("<p><em>a <strong>b</strong> c</em></p>");
    expect(html("**sem fim")).toBe("<p>**sem fim</p>");
  });

  it("escapes every text and every value", () => {
    expect(html("<script>alert(1)</script>")).toBe(
      "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
    );
    expect(
      html("Olá {{organizacao}}", { organizacao: '<img src=x onerror="x">' }),
    ).toBe("<p>Olá &lt;img src=x onerror=&quot;x&quot;&gt;</p>");
    expect(html('<a href="javascript:alert(1)">x</a>')).not.toContain("<a");
  });

  it("links only to http(s) or a link variable", () => {
    expect(html("[Abrir](https://ex.com/a?b=1&c=2)")).toBe(
      '<p><a href="https://ex.com/a?b=1&amp;c=2">Abrir</a></p>',
    );
    expect(html("[Abrir]({{link}})", { link: "https://ex.com/x" })).toBe(
      '<p><a href="https://ex.com/x">Abrir</a></p>',
    );
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,<b>x</b>",
      "//ex.com",
      "/relative",
      'https://ex.com/"onmouseover="x',
    ]) {
      const out = html(`[x](${bad})`);
      expect(out).not.toContain("<a");
      expect(out).not.toContain("javascript");
    }
    // A link variable whose value is not a safe address shows only the label.
    expect(html("[Abrir]({{link}})", { link: "javascript:alert(1)" })).toBe(
      "<p>Abrir</p>",
    );
  });

  it("keeps escaped characters literal", () => {
    expect(html("\\*não\\* \\[x\\](y) \\{{marca}}")).toBe(
      "<p>*não* [x](y) {{marca}}</p>",
    );
    expect(html("\\# não é título")).toBe("<p># não é título</p>");
  });

  it("colors links and headings only with a hex color", () => {
    const blocks = parseMarkup("## T\n\n[a](https://ex.com)");
    expect(renderMarkupHtml(blocks, {}, { color: "#112233" })).toContain(
      'style="color:#112233"',
    );
    expect(
      renderMarkupHtml(blocks, {}, { color: "red;background:url(x)" }),
    ).not.toContain("style=");
  });

  it("survives pathological input quickly", () => {
    const started = Date.now();
    parseMarkup("**[*".repeat(2_500));
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("renderMarkupText", () => {
  it("writes lists, links and values as plain text", () => {
    expect(
      text("Olá **{{organizacao}}**\n\n- a\n- b\n\n[Abrir]({{link}})", {
        organizacao: "<X>",
        link: "https://ex.com",
      }),
    ).toBe("Olá <X>\n\n- a\n- b\n\nAbrir: https://ex.com/");
    expect(text("Veja [aqui](https://ex.com) agora")).toBe(
      "Veja aqui (https://ex.com/) agora",
    );
  });
});

describe("fillSubject", () => {
  it("replaces tags and keeps one line", () => {
    expect(
      fillSubject("Convite {{ organizacao }}", { organizacao: "A\r\nB" }),
    ).toBe("Convite A B");
    expect(fillSubject("{{desconhecida}} x", {})).toBe("x");
    expect(fillSubject("a".repeat(300), {})).toHaveLength(200);
  });
});

describe("validateTemplate", () => {
  const ok = { subject: "Convite para {{organizacao}}", body: "Olá" };

  it("accepts known tags and good links", () => {
    expect(
      validateTemplate(
        { ...ok, body: "[Aceitar]({{link}}) em [site](https://ex.com)" },
        VARIABLES,
      ),
    ).toEqual([]);
  });

  it("refuses unknown tags in the subject and the body", () => {
    expect(
      validateTemplate(
        { subject: "{{senha}}", body: "{{Organizacao}} [x]({{token}})" },
        VARIABLES,
      ),
    ).toEqual([
      { field: "subject", code: "unknown_tag", tag: "senha" },
      { field: "body", code: "unknown_tag", tag: "Organizacao" },
      { field: "body", code: "unknown_tag", tag: "token" },
    ]);
  });

  it("refuses bad links and text variables as links", () => {
    expect(
      validateTemplate({ ...ok, body: "[x](javascript:alert(1))" }, VARIABLES),
    ).toEqual([{ field: "body", code: "bad_link" }]);
    expect(
      validateTemplate({ ...ok, body: "[x]({{marca}})" }, VARIABLES),
    ).toEqual([{ field: "body", code: "tag_not_link", tag: "marca" }]);
  });

  it("refuses empty, multi-line and oversized fields", () => {
    expect(validateTemplate({ subject: " ", body: "" }, VARIABLES)).toEqual([
      { field: "subject", code: "required" },
      { field: "body", code: "required" },
    ]);
    expect(validateTemplate({ ...ok, subject: "a\nb" }, VARIABLES)).toEqual([
      { field: "subject", code: "newline" },
    ]);
    expect(
      validateTemplate({ ...ok, body: "x".repeat(10_001) }, VARIABLES),
    ).toEqual([{ field: "body", code: "too_long" }]);
  });
});

describe("escapeMarkup", () => {
  it("round-trips plain text literally", () => {
    for (const value of [
      "Preço *promocional* [hoje] {x}",
      "# não é título",
      "- não é lista",
      "1. não é lista",
      "barra \\ invertida",
    ]) {
      expect(text(escapeMarkup(value))).toBe(value);
    }
  });
});

describe("isHttpUrl", () => {
  it("accepts only absolute http(s) addresses", () => {
    expect(isHttpUrl("https://ex.com")).toBe(true);
    expect(isHttpUrl("http://ex.com/a")).toBe(true);
    expect(isHttpUrl("mailto:a@b.c")).toBe(false);
    expect(isHttpUrl("https://ex.com/a b")).toBe(false);
  });
});
