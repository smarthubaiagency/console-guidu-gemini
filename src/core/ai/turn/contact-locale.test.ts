import { describe, expect, it } from "vitest";

import { contactLocaleInstruction } from "./contact-locale";

/** TR1: the GUIDS answers the contact in the contact's language. */
describe("contactLocaleInstruction", () => {
  it("tells the agent, in its language, the contact's other language", () => {
    expect(contactLocaleInstruction("pt-BR", "es")).toContain(
      "Responda ao contato em espanhol",
    );
    expect(contactLocaleInstruction("en", "pt-BR")).toContain(
      "Answer the contact in Portuguese",
    );
    expect(contactLocaleInstruction("es", "en")).toContain(
      "Responde al contacto en inglés",
    );
  });

  it("says nothing when the language is the agent's or unknown", () => {
    expect(contactLocaleInstruction("pt-BR", "pt-BR")).toBeNull();
    expect(contactLocaleInstruction("es", "es")).toBeNull();
    expect(contactLocaleInstruction("pt-BR", null)).toBeNull();
    expect(contactLocaleInstruction("en", undefined)).toBeNull();
  });
});
