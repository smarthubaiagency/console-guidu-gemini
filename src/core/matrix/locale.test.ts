import { describe, expect, it } from "vitest";

import {
  contactLocaleOf,
  detectContactLocale,
  isContactLocale,
} from "./locale";

/** TR1: the contact's language from one message of a tourist. */

const locale = (text: string) => detectContactLocale(text)?.locale ?? null;

describe("detectContactLocale", () => {
  it("knows Spanish, Portuguese and English messages of tourists", () => {
    expect(locale("¡Hola! ¿Tienen paseo en barco para mañana?")).toBe("es");
    expect(locale("Somos 6 personas y queremos ir a Geribá")).toBe("es");
    expect(locale("Hola, cuánto cuesta el paseo?")).toBe("es");
    expect(locale("Olá, vocês têm passeio de barco amanhã?")).toBe("pt-BR");
    expect(locale("Bom dia, quanto custa a reserva para duas pessoas?")).toBe(
      "pt-BR",
    );
    expect(locale("Hi, do you have a boat tour available tomorrow?")).toBe(
      "en",
    );
    expect(locale("How much is it for 4 people?")).toBe("en");
  });

  it("decides nothing on short or empty messages", () => {
    for (const text of ["ok", "gracias", "obrigado!", "👍", "18", "sim", ""]) {
      expect(detectContactLocale(text)).toBeNull();
    }
  });

  it("decides on a strong sign even when short", () => {
    expect(locale("¿Cuándo?")).toBe("es");
    expect(locale("Não sei")).toBe("pt-BR");
  });

  it("ignores links and mentions", () => {
    expect(
      locale("https://example.com/the/boat/tour/is/great @the_hotel ok"),
    ).toBeNull();
  });

  it("does not decide when the languages are mixed half and half", () => {
    expect(detectContactLocale("hello hola the el")).toBeNull();
  });

  it("returns a confidence between the minimum and 1", () => {
    const guess = detectContactLocale("¿Tienen disponibilidad para hoy?");
    expect(guess?.locale).toBe("es");
    expect(guess?.confidence).toBeGreaterThanOrEqual(0.6);
    expect(guess?.confidence).toBeLessThanOrEqual(1);
  });

  it("only accepts the three languages of the pilot", () => {
    expect(isContactLocale("es")).toBe(true);
    expect(isContactLocale("fr")).toBe(false);
  });
});

describe("contactLocaleOf", () => {
  it("brings a workspace's language to one of the three", () => {
    expect(contactLocaleOf("en-US")).toBe("en");
    expect(contactLocaleOf("es")).toBe("es");
    expect(contactLocaleOf("pt-BR")).toBe("pt-BR");
    expect(contactLocaleOf(null)).toBe("pt-BR");
  });
});
