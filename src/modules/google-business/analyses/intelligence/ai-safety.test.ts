import { describe, expect, it } from "vitest";

import {
  descriptionProblems,
  firstName,
  namesInText,
  namesKeyword,
  replyProblems,
  templateReply,
} from "./ai-safety";

const CONTEXT = {
  reviewText: "Fui atendida pela Juliana e o implante ficou ótimo. Recomendo!",
  authorFirstName: "Ana",
  businessName: "Clínica Sorriso",
};

describe("safety filters of the AI suggestions (GB1b, §9)", () => {
  it("refuses links, contacts and promotions in the description", () => {
    expect(descriptionProblems("Clínica no Centro com atendimento de segunda a sábado.")).toEqual([]);
    expect(descriptionProblems("Veja www.clinica.com.br")).toEqual(["link"]);
    expect(descriptionProblems("Ligue (11) 3000-0000")).toEqual(["contact"]);
    expect(descriptionProblems("Fale em contato@clinica.com")).toContain("contact");
    expect(descriptionProblems("Clareamento com 20% de desconto")).toEqual(["promotion"]);
    expect(descriptionProblems("Primeira consulta grátis")).toEqual(["promotion"]);
    expect(descriptionProblems("Huge sale this week")).toEqual(["promotion"]);
  });

  it("never lets a reply confirm a health treatment or other sensitive data", () => {
    expect(replyProblems("Que bom que o seu implante ficou ótimo, Ana!", CONTEXT)).toContain("sensitive");
    expect(replyProblems("Obrigado pela confiança no tratamento.", CONTEXT)).toContain("sensitive");
    expect(replyProblems("Seu processo de divórcio está em boas mãos.", CONTEXT)).toContain("sensitive");
    expect(replyProblems("Glad the surgery went well!", CONTEXT)).toContain("sensitive");
    expect(replyProblems("Obrigado pela visita, Ana! Esperamos ver você de novo.", CONTEXT)).toEqual([]);
  });

  it("never names an employee the review mentioned, nor amounts, nor argues", () => {
    expect(replyProblems("A Juliana agradece a visita!", CONTEXT)).toEqual(["staff"]);
    expect(replyProblems("Obrigado, Ana! A equipe da Clínica Sorriso agradece.", CONTEXT)).toEqual([]);
    expect(replyProblems("Você pagou R$ 300 e merece o melhor.", CONTEXT)).toContain("money");
    expect(replyProblems("Isso é mentira, você nunca esteve aqui.", CONTEXT)).toContain("arguing");
    expect(namesInText(CONTEXT.reviewText)).toEqual(["Juliana"]);
  });

  it("writes safe templates in the three languages", () => {
    for (const language of ["pt-BR", "es", "en"] as const) {
      for (const rating of [1, 2, 3, 4, 5]) {
        const text = templateReply(language, rating, "Ana");
        expect(text).toContain("Ana");
        expect(replyProblems(text, CONTEXT)).toEqual([]);
        expect(descriptionProblems(text)).toEqual([]);
      }
    }
    expect(templateReply("pt-BR", 1, null)).not.toContain(",  ");
    expect(firstName("  Ana Souza ")).toBe("Ana");
    expect(firstName("A")).toBeNull();
  });

  it("spots a keyword or the city in the profile name", () => {
    expect(namesKeyword("Clínica Sorriso Dentista Campinas", ["Dentista", "Campinas"])).toBe(true);
    expect(namesKeyword("Clínica Sorriso", ["Dentista", "Campinas"])).toBe(false);
    expect(namesKeyword("Bar do Zé", [null, "Rio"])).toBe(false);
  });
});
