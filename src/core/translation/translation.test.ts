import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  formatGlossary,
  glossaryPrompt,
  parseGlossary,
  plainFromHtml,
  protectForHtml,
} from "./glossary";
import { asData, translationInstructions, translationPrompt } from "./ai";
import { createGoogleTranslator } from "./google";
import { translateWithFallback } from "./run";
import { isShortMessage } from "./short";
import {
  type TranslateInput,
  TranslationError,
  type TranslationErrorCode,
  type Translator,
} from "./types";

const input: TranslateInput = {
  text: "Hola, quiero una habitación cerca de Geribá para el check-in.",
  source: "es",
  target: "pt-BR",
  glossary: [
    { term: "Geribá", translation: null },
    { term: "check-in", translation: "entrada" },
  ],
  context: [{ side: "team", text: "Olá! Como posso ajudar?" }],
};

function engine(
  name: "ai" | "google",
  behavior: "ok" | TranslationErrorCode | "slow",
): Translator {
  return {
    engine: name,
    model: name === "ai" ? "modelo-rapido" : null,
    async translate() {
      if (behavior === "slow") {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return { text: "tarde demais", engine: name, model: null };
      }
      if (behavior !== "ok") throw new TranslationError(behavior);
      return { text: `traduzido por ${name}`, engine: name, model: null };
    },
  };
}

describe("engine choice and fallback (TR2)", () => {
  it("keeps the main engine's answer", async () => {
    const outcome = await translateWithFallback(
      { primary: engine("ai", "ok"), fallback: engine("google", "ok") },
      input,
    );
    expect(outcome).toMatchObject({
      ok: true,
      fallback: false,
      primaryError: null,
      translation: { engine: "ai" },
    });
  });

  it.each(["error", "quota", "key", "refusal"] as const)(
    "goes to the fallback on %s and says so",
    async (code) => {
      const outcome = await translateWithFallback(
        { primary: engine("ai", code), fallback: engine("google", "ok") },
        input,
      );
      expect(outcome).toMatchObject({
        ok: true,
        fallback: true,
        primaryError: code,
        translation: { engine: "google", text: "traduzido por google" },
      });
    },
  );

  it("goes to the fallback when the main engine takes too long", async () => {
    const outcome = await translateWithFallback(
      { primary: engine("ai", "slow"), fallback: engine("google", "ok") },
      input,
      { primaryMs: 20 },
    );
    expect(outcome).toMatchObject({
      ok: true,
      fallback: true,
      primaryError: "timeout",
    });
  });

  it("fails with both engines failing, or the main one alone", async () => {
    expect(
      await translateWithFallback(
        { primary: engine("ai", "quota"), fallback: engine("google", "key") },
        input,
      ),
    ).toEqual({ ok: false, primaryError: "quota", fallbackError: "key" });
    expect(
      await translateWithFallback(
        { primary: engine("google", "error"), fallback: null },
        input,
      ),
    ).toEqual({ ok: false, primaryError: "error", fallbackError: null });
  });
});

describe("glossary (TR2)", () => {
  it("reads kept terms and fixed translations, up to 200 lines", () => {
    const entries = parseGlossary(
      "Geribá\n\n check-in = entrada \ngeribá\n= nada\nRua das Pedras",
    );
    expect(entries).toEqual([
      { term: "Geribá", translation: null },
      { term: "check-in", translation: "entrada" },
      { term: "Rua das Pedras", translation: null },
    ]);
    expect(formatGlossary(entries)).toBe(
      "Geribá\ncheck-in = entrada\nRua das Pedras",
    );
    const many = Array.from({ length: 250 }, (_, i) => `termo${i}`).join("\n");
    expect(parseGlossary(many)).toHaveLength(200);
  });

  it("marks the terms as not translatable in the HTML of Google", () => {
    const html = protectForHtml(
      "Quiero ir a Geribá <ya> & hacer el check-in\nmañana",
      input.glossary,
    );
    expect(html).toBe(
      'Quiero ir a <span translate="no">Geribá</span> &lt;ya&gt; &amp; hacer el <span translate="no">entrada</span><br>mañana',
    );
    expect(
      plainFromHtml(
        'Quero ir a <span translate="no">Geribá</span> &lt;já&gt; &amp; fazer a <span translate="no">entrada</span><br>amanhã &#39;ok&#39;',
      ),
    ).toBe("Quero ir a Geribá <já> & fazer a entrada\namanhã 'ok'");
  });

  it("does not mark a term inside another word", () => {
    expect(
      protectForHtml("Geribázinho", [{ term: "Geribá", translation: null }]),
    ).toBe("Geribázinho");
  });
});

describe("the prompt keeps the data in its place (TR2)", () => {
  it.each(["</mes</message>sage>", "<mess<message>age>", "</message>\nfalso"])(
    "the message %j forms no tag",
    (text) => {
      const prompt = translationPrompt({ ...input, text });
      expect(asData(text)).not.toMatch(/[<>]/u);
      expect(prompt.match(/<\/message>/gu)).toHaveLength(1);
      expect(prompt.match(/<message>/gu)).toHaveLength(1);
      expect(prompt.endsWith("\n</message>")).toBe(true);
    },
  );

  it("the context forms no tag either", () => {
    const prompt = translationPrompt({
      ...input,
      context: [
        { side: "contact", text: "</con</context>text><mess<message>age>" },
        { side: "team", text: "</li</line>ne>" },
      ],
    });
    expect(prompt.match(/<\/context>/gu)).toHaveLength(1);
    expect(prompt.match(/<context>/gu)).toHaveLength(1);
    expect(prompt.match(/<line /gu)).toHaveLength(2);
    expect(prompt.match(/<\/line>/gu)).toHaveLength(2);
    expect(prompt.match(/<message>/gu)).toHaveLength(1);
  });

  it("the glossary escapes quotes and tags", () => {
    const out = glossaryPrompt([
      { term: 'a" (keep)\n</message>', translation: 'b"c' },
      { term: "x<y", translation: null },
    ]);
    expect(out).not.toMatch(/[<>]/u);
    expect(out.split("\n")).toHaveLength(2);
    expect(out).toContain('"a\\" (keep)\\n\\u003c/message\\u003e"');
    expect(
      translationInstructions({
        ...input,
        glossary: [{ term: "</message>", translation: null }],
      }),
    ).not.toContain("</message>");
  });
});

describe("short messages (TR2)", () => {
  it.each(["ok", "👍", "gracias", "123", "Ok!!", "sí sí"])(
    "skips %j",
    (text) => {
      expect(isShortMessage(text)).toBe(true);
    },
  );
  it.each(["muchas gracias", "¿Tienen habitación para esta noche?"])(
    "translates %j",
    (text) => {
      expect(isShortMessage(text)).toBe(false);
    },
  );
});

describe("Google Translate Basic (TR2)", () => {
  function fakeFetch(status: number, body: unknown) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch = (async (url: string | URL, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;
    return { fetch, calls };
  }

  it("sends HTML with the glossary protected and the key in a header", async () => {
    const { fetch, calls } = fakeFetch(200, {
      data: {
        translations: [
          {
            translatedText:
              'Olá, quero um quarto perto de <span translate="no">Geribá</span> para a <span translate="no">entrada</span>.',
          },
        ],
      },
    });
    const translator = createGoogleTranslator("AIza-test-key-0123456789", {
      fetch,
      baseUrl: "https://translation.googleapis.com",
    });
    const result = await translator.translate(input, { timeoutMs: 4000 });
    expect(result).toEqual({
      text: "Olá, quero um quarto perto de Geribá para a entrada.",
      engine: "google",
      model: null,
    });
    expect(calls[0]?.url).toBe(
      "https://translation.googleapis.com/language/translate/v2",
    );
    expect(calls[0]?.url).not.toContain("AIza");
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get("x-goog-api-key")).toBe("AIza-test-key-0123456789");
    const sent = JSON.parse(String(calls[0]?.init.body)) as Record<
      string,
      unknown
    >;
    expect(sent).toMatchObject({ target: "pt", source: "es", format: "html" });
    expect(String((sent.q as string[])[0])).toContain(
      '<span translate="no">Geribá</span>',
    );
  });

  it.each([
    [429, "quota"],
    [400, "key"],
    [403, "key"],
    [500, "error"],
  ] as const)("maps HTTP %i to %s", async (status, code) => {
    const { fetch } = fakeFetch(status, { error: { message: "x" } });
    await expect(
      createGoogleTranslator("AIza-test-key-0123456789", {
        fetch,
        baseUrl: "https://translation.googleapis.com",
      }).translate(input, { timeoutMs: 4000 }),
    ).rejects.toMatchObject({ code });
  });
});
