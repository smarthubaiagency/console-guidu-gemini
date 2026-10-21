import { describe, expect, it } from "vitest";

import { outboundGlossary } from "./glossary";
import { decideOutbound } from "./outbound";
import { translateOutbound } from "./run";
import {
  type TranslateInput,
  TranslationError,
  type TranslationErrorCode,
  type Translator,
} from "./types";

/**
 * TR3: when the team's answer is translated (the rule shared by the window
 * and the server) and the direct translation of the preview (main engine,
 * the 4 s, the fallback, the glossary read the other way round).
 */

const base = {
  enabled: true,
  mode: "reply",
  teamLocale: "pt-BR",
  contactLocale: "es",
  text: "Temos quarto disponível para duas pessoas esta noite.",
} as const;

describe("decideOutbound", () => {
  it("translates with the translation on, the contact in another language, in reply mode", () => {
    expect(decideOutbound(base)).toEqual({
      translate: true,
      source: "pt-BR",
      target: "es",
    });
  });

  it("never translates a private note", () => {
    expect(decideOutbound({ ...base, mode: "note" })).toEqual({
      translate: false,
      reason: "note",
    });
  });

  it("does not translate with the translation off", () => {
    expect(decideOutbound({ ...base, enabled: false })).toEqual({
      translate: false,
      reason: "off",
    });
  });

  it("does not translate while the contact's language is unknown", () => {
    expect(decideOutbound({ ...base, contactLocale: null })).toEqual({
      translate: false,
      reason: "unknown_locale",
    });
  });

  it("does not translate when the contact speaks the team's language", () => {
    expect(decideOutbound({ ...base, contactLocale: "pt-BR" })).toEqual({
      translate: false,
      reason: "same_locale",
    });
  });

  it("goes direct when the draft is already in the contact's language", () => {
    const spanish = "Tenemos una habitación disponible para esta noche.";
    expect(decideOutbound({ ...base, text: spanish })).toEqual({
      translate: false,
      reason: "already_in_contact_language",
    });
    // The ✦ asks for the preview anyway.
    expect(decideOutbound({ ...base, text: spanish, force: true })).toEqual({
      translate: true,
      source: "pt-BR",
      target: "es",
    });
  });

  it("still translates a draft in a third language, and a short one that decides nothing", () => {
    expect(
      decideOutbound({
        ...base,
        text: "We have a room available for tonight, for two people.",
      }).translate,
    ).toBe(true);
    expect(decideOutbound({ ...base, text: "Obrigado" }).translate).toBe(true);
  });

  it("does not translate a text with no letters", () => {
    expect(decideOutbound({ ...base, text: "👍 123" })).toEqual({
      translate: false,
      reason: "no_text",
    });
  });
});

function engine(
  name: "ai" | "google",
  answer: string | TranslationErrorCode,
  seen: TranslateInput[] = [],
  delayMs = 0,
): Translator {
  return {
    engine: name,
    model: name === "ai" ? "gpt-5-nano" : null,
    async translate(input) {
      seen.push(input);
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (["key", "quota", "timeout", "refusal", "error"].includes(answer)) {
        throw new TranslationError(answer as TranslationErrorCode);
      }
      return {
        text: answer,
        engine: name,
        model: name === "ai" ? "gpt-5-nano" : null,
      };
    },
  };
}

const input = {
  text: "Temos quarto para duas pessoas.",
  source: "pt-BR",
  target: "es",
  glossary: [
    { term: "Geribá", translation: null },
    { term: "check-in", translation: "entrada" },
  ],
} as const;

describe("translateOutbound", () => {
  it("uses the main engine, with no context and the glossary the other way round", async () => {
    const seen: TranslateInput[] = [];
    const outcome = await translateOutbound(
      { primary: engine("ai", "Tenemos habitación.", seen), fallback: null },
      input,
    );
    expect(outcome).toMatchObject({
      ok: true,
      fallback: false,
      translation: { text: "Tenemos habitación.", engine: "ai" },
    });
    expect(seen[0]?.context).toEqual([]);
    expect(seen[0]?.target).toBe("es");
    expect(seen[0]?.glossary).toEqual([
      { term: "Geribá", translation: null },
      { term: "entrada", translation: "check-in" },
    ]);
  });

  it("goes to the fallback when the main engine fails, and says so", async () => {
    const outcome = await translateOutbound(
      {
        primary: engine("ai", "quota"),
        fallback: engine("google", "Tenemos habitación."),
      },
      input,
    );
    expect(outcome).toMatchObject({
      ok: true,
      fallback: true,
      primaryError: "quota",
      translation: { engine: "google" },
    });
  });

  it("goes to the fallback after the main engine's time", async () => {
    const outcome = await translateOutbound(
      {
        primary: engine("ai", "Tarde.", [], 200),
        fallback: engine("google", "Tenemos habitación."),
      },
      input,
      { primaryMs: 20 },
    );
    expect(outcome).toMatchObject({
      ok: true,
      fallback: true,
      primaryError: "timeout",
    });
  });

  it("fails, to send nothing, when both engines fail", async () => {
    expect(
      await translateOutbound(
        { primary: engine("ai", "key"), fallback: engine("google", "error") },
        input,
      ),
    ).toEqual({ ok: false, primaryError: "key", fallbackError: "error" });
    expect(
      await translateOutbound(
        { primary: engine("google", "refusal"), fallback: null },
        input,
      ),
    ).toEqual({ ok: false, primaryError: "refusal", fallbackError: null });
  });
});

describe("outboundGlossary", () => {
  it("keeps the terms kept as they are and reads the fixed ones backwards", () => {
    expect(
      outboundGlossary([
        { term: "Rua das Pedras", translation: null },
        { term: "check-in", translation: "entrada" },
      ]),
    ).toEqual([
      { term: "Rua das Pedras", translation: null },
      { term: "entrada", translation: "check-in" },
    ]);
  });
});
