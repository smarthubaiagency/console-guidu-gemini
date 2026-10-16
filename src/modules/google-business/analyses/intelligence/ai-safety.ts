import type { SuggestionsLanguage } from "./ai-schema";

/**
 * Safety filters of the AI suggestions (GB1b), applied after the Zod
 * validation, from the fixed rules of the specification:
 *
 * - §9.2 / §5: the description has no link, contact or promotion, and the
 *   name carries no keyword, city or slogan;
 * - §9.3: a reply never confirms a sensitive relationship (health, legal,
 *   financial), never names an employee, never mentions an amount paid and
 *   never argues with the customer.
 *
 * A reply that fails is replaced by a safe template of its star band; a
 * description that fails is dropped. The lists are conservative on purpose:
 * a false positive costs a template reply, a false negative exposes data.
 */

export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

const LINK =
  /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|com\.br|net|org|br|io|app|site|link|me)\b)/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE = /(\+?\d[\d\s().-]{7,}\d)/;
const PROMOTION = new RegExp(
  "\\b(" +
    [
      // pt-BR
      "desconto",
      "descontos",
      "promocao",
      "promocoes",
      "promo",
      "oferta",
      "ofertas",
      "gratis",
      "gratuito",
      "gratuita",
      "cupom",
      "cupons",
      "liquidacao",
      "imperdivel",
      "black friday",
      "frete gratis",
      // es
      "descuento",
      "descuentos",
      "promocion",
      "promociones",
      "cupon",
      "rebaja",
      "rebajas",
      // en
      "discount",
      "discounts",
      "sale",
      "free",
      "coupon",
      "coupons",
      "offer",
      "offers",
      "deal",
      "deals",
    ].join("|") +
    ")\\b|\\d+\\s?%\\s?(off)?",
  "i",
);

export type DescriptionProblem = "link" | "contact" | "promotion";

export function descriptionProblems(text: string): DescriptionProblem[] {
  const folded = fold(text);
  const problems: DescriptionProblem[] = [];
  if (LINK.test(folded)) problems.push("link");
  if (EMAIL.test(folded) || PHONE.test(folded)) problems.push("contact");
  if (PROMOTION.test(folded)) problems.push("promotion");
  return problems;
}

/** Words that, in a reply, would confirm a sensitive relationship (§9.3). */
const SENSITIVE_TERMS = [
  // Health (pt-BR)
  "implante",
  "implantes",
  "tratamento",
  "tratamentos",
  "cirurgia",
  "cirurgias",
  "consulta",
  "consultas",
  "exame",
  "exames",
  "diagnostico",
  "terapia",
  "sessao",
  "sessoes",
  "medicamento",
  "medicamentos",
  "remedio",
  "remedios",
  "receita medica",
  "procedimento",
  "procedimentos",
  "clareamento",
  "canal",
  "aparelho",
  "protese",
  "botox",
  "harmonizacao",
  "lipo",
  "dieta",
  "gravidez",
  "gestacao",
  "parto",
  "psicologo",
  "psicologa",
  "psiquiatra",
  "ansiedade",
  "depressao",
  "cancer",
  "hiv",
  "doenca",
  "doencas",
  "dor",
  "dores",
  "fisioterapia",
  "vacina",
  "internacao",
  // Legal and financial (pt-BR)
  "processo",
  "processos",
  "acao judicial",
  "divorcio",
  "inventario",
  "advogado",
  "advogada",
  "audiencia",
  "emprestimo",
  "emprestimos",
  "divida",
  "dividas",
  "financiamento",
  "credito",
  "negativado",
  "falencia",
  // es
  "tratamiento",
  "tratamientos",
  "cirugia",
  "diagnostico",
  "medicamento",
  "embarazo",
  "psicologo",
  "enfermedad",
  "demanda",
  "juicio",
  "prestamo",
  "deuda",
  "deudas",
  // en
  "treatment",
  "treatments",
  "surgery",
  "implant",
  "implants",
  "diagnosis",
  "therapy",
  "prescription",
  "medication",
  "pregnancy",
  "disease",
  "illness",
  "lawsuit",
  "divorce",
  "attorney",
  "loan",
  "loans",
  "debt",
  "debts",
  "bankruptcy",
];

const SENSITIVE = new RegExp(`\\b(${SENSITIVE_TERMS.join("|")})\\b`, "i");
const MONEY =
  /(r\$|us\$|\$|€|£)\s?\d|\b\d+([.,]\d+)?\s?(reais|dolares|dollars|euros|pesos)\b/i;
const ARGUING = new RegExp(
  "\\b(" +
    [
      "mentira",
      "mentiroso",
      "mentirosa",
      "falso",
      "falsa",
      "absurdo",
      "voce esta errado",
      "voce esta errada",
      "nao e verdade",
      "calunia",
      "difamacao",
      "es falso",
      "no es verdad",
      "usted esta equivocado",
      "lie",
      "liar",
      "not true",
      "you are wrong",
      "false review",
      "fake review",
      "defamation",
    ].join("|") +
    ")\\b",
  "i",
);

export type ReplyProblem = "sensitive" | "money" | "staff" | "arguing";

/**
 * Names written in the review in the middle of a sentence (capitalised,
 * not after a full stop): probably people, such as an employee.
 */
export function namesInText(text: string): string[] {
  const names = new Set<string>();
  const words = text.split(/\s+/);
  for (let index = 1; index < words.length; index += 1) {
    const previous = words[index - 1]!;
    if (/[.!?:]$/.test(previous)) continue;
    const word = words[index]!.replace(/[^\p{L}'-]/gu, "");
    if (word.length >= 3 && /^\p{Lu}\p{Ll}+$/u.test(word)) names.add(word);
  }
  return [...names];
}

export function replyProblems(
  reply: string,
  context: Readonly<{
    reviewText: string | null;
    authorFirstName: string | null;
    businessName: string;
  }>,
): ReplyProblem[] {
  const folded = fold(reply);
  const problems: ReplyProblem[] = [];
  if (SENSITIVE.test(folded)) problems.push("sensitive");
  if (MONEY.test(folded)) problems.push("money");
  if (ARGUING.test(folded)) problems.push("arguing");
  if (context.reviewText) {
    const allowed = new Set(
      [context.authorFirstName ?? "", ...context.businessName.split(/\s+/)]
        .map((word) => fold(word.replace(/[^\p{L}'-]/gu, "")))
        .filter(Boolean),
    );
    const replyWords = new Set(
      reply.split(/\s+/).map((word) => fold(word.replace(/[^\p{L}'-]/gu, ""))),
    );
    const staff = namesInText(context.reviewText).some((name) => {
      const key = fold(name);
      return !allowed.has(key) && replyWords.has(key);
    });
    if (staff) problems.push("staff");
  }
  return problems;
}

export function namesKeyword(
  name: string,
  terms: readonly (string | null)[],
): boolean {
  const folded = ` ${fold(name).replace(/[^a-z0-9]+/g, " ")} `;
  return terms.some((term) => {
    if (!term) return false;
    const key = fold(term)
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    return key.length >= 4 && folded.includes(` ${key} `);
  });
}

const TEMPLATES: Record<
  SuggestionsLanguage,
  Record<"good" | "neutral" | "bad", (name: string | null) => string>
> = {
  "pt-BR": {
    good: (name) =>
      `Obrigado pela avaliação${name ? `, ${name}` : ""}! Ficamos muito felizes com o seu retorno e esperamos ver você de novo em breve.`,
    neutral: (name) =>
      `Obrigado pelo retorno${name ? `, ${name}` : ""}. A sua opinião nos ajuda a melhorar. Se quiser contar mais, fale com a gente pelos nossos canais de atendimento.`,
    bad: (name) =>
      `Sentimos muito que a sua experiência não tenha sido boa${name ? `, ${name}` : ""}. Queremos entender o que aconteceu: fale com a gente pelos nossos canais de atendimento para conversarmos em particular.`,
  },
  es: {
    good: (name) =>
      `¡Gracias por tu reseña${name ? `, ${name}` : ""}! Nos alegra mucho tu comentario y esperamos verte pronto.`,
    neutral: (name) =>
      `Gracias por tu comentario${name ? `, ${name}` : ""}. Tu opinión nos ayuda a mejorar. Si quieres contarnos más, escríbenos por nuestros canales de atención.`,
    bad: (name) =>
      `Lamentamos que tu experiencia no haya sido buena${name ? `, ${name}` : ""}. Queremos entender qué pasó: escríbenos por nuestros canales de atención para hablar en privado.`,
  },
  en: {
    good: (name) =>
      `Thank you for your review${name ? `, ${name}` : ""}! We are very glad to hear from you and hope to see you again soon.`,
    neutral: (name) =>
      `Thank you for your feedback${name ? `, ${name}` : ""}. Your opinion helps us improve. If you would like to tell us more, please reach us through our service channels.`,
    bad: (name) =>
      `We are sorry your experience was not good${name ? `, ${name}` : ""}. We want to understand what happened: please reach us through our service channels so we can talk in private.`,
  },
};

/** Safe reply of a star band: no detail of the visit, nothing sensitive. */
export function templateReply(
  language: SuggestionsLanguage,
  rating: number,
  authorFirstName: string | null,
): string {
  const band = rating >= 4 ? "good" : rating === 3 ? "neutral" : "bad";
  return TEMPLATES[language][band](authorFirstName);
}

export function firstName(author: string | null): string | null {
  const first = author
    ?.trim()
    .split(/\s+/)[0]
    ?.replace(/[^\p{L}'-]/gu, "");
  return first && first.length >= 2 && first.length <= 40 ? first : null;
}
