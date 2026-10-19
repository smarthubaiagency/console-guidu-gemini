/**
 * The contact's language (TR1, docs/modules/inbox/traducao.md): Portuguese,
 * English or Spanish, guessed from one message of the consumer, in memory.
 * Common words weigh by how many of the three languages share them, and a
 * few signs are strong on their own (¿ ¡ ñ for Spanish; ã õ ç for
 * Portuguese). A short or ambiguous message decides nothing, so "ok",
 * "gracias" or an emoji never change a language already known. No
 * dependency: three languages and a pilot do not need one.
 */

export const CONTACT_LOCALES = ["pt-BR", "en", "es"] as const;
export type ContactLocale = (typeof CONTACT_LOCALES)[number];

export function isContactLocale(value: unknown): value is ContactLocale {
  return (
    typeof value === "string" &&
    (CONTACT_LOCALES as readonly string[]).includes(value)
  );
}

export type LocaleGuess = Readonly<{
  locale: ContactLocale;
  /** Share of the evidence that points to the language, 0 to 1. */
  confidence: number;
}>;

/** Below this, the guess is not stored. */
export const MIN_CONFIDENCE = 0.6;
/** Words a message needs to decide, without a strong sign. */
const MIN_WORDS = 3;
/** Weighted evidence the winner needs. */
const MIN_SCORE = 1.5;

const WORDS: Readonly<Record<ContactLocale, readonly string[]>> = {
  "pt-BR": [
    "que",
    "não",
    "nao",
    "você",
    "voce",
    "vocês",
    "voces",
    "para",
    "com",
    "uma",
    "um",
    "os",
    "as",
    "do",
    "da",
    "dos",
    "das",
    "no",
    "na",
    "nos",
    "em",
    "é",
    "está",
    "esta",
    "estou",
    "tem",
    "têm",
    "obrigado",
    "obrigada",
    "olá",
    "ola",
    "oi",
    "bom",
    "boa",
    "dia",
    "tarde",
    "noite",
    "quero",
    "gostaria",
    "quanto",
    "custa",
    "por",
    "favor",
    "sim",
    "também",
    "tambem",
    "muito",
    "mais",
    "isso",
    "aqui",
    "amanhã",
    "amanha",
    "hoje",
    "meu",
    "minha",
    "seu",
    "sua",
    "onde",
    "fica",
    "como",
    "qual",
    "quais",
    "pessoas",
    "somos",
    "tudo",
    "vocês",
    "posso",
    "pode",
    "e",
    "mas",
    "ou",
    "eu",
    "nós",
    "nosso",
    "nossa",
    "então",
    "entao",
  ],
  es: [
    "que",
    "no",
    "usted",
    "ustedes",
    "para",
    "con",
    "una",
    "un",
    "los",
    "las",
    "el",
    "la",
    "del",
    "de",
    "en",
    "es",
    "está",
    "esta",
    "estoy",
    "tiene",
    "tienen",
    "gracias",
    "hola",
    "buenos",
    "buenas",
    "días",
    "dias",
    "tardes",
    "noches",
    "quiero",
    "quisiera",
    "cuánto",
    "cuanto",
    "cuesta",
    "por",
    "favor",
    "sí",
    "si",
    "también",
    "tambien",
    "muy",
    "más",
    "mas",
    "eso",
    "aquí",
    "aqui",
    "mañana",
    "manana",
    "hoy",
    "mi",
    "su",
    "dónde",
    "donde",
    "queda",
    "cómo",
    "como",
    "cual",
    "cuál",
    "personas",
    "somos",
    "hay",
    "pero",
    "y",
    "yo",
    "nosotros",
    "puedo",
    "puede",
    "todo",
    "entonces",
    "vamos",
  ],
  en: [
    "the",
    "you",
    "your",
    "is",
    "are",
    "do",
    "does",
    "have",
    "has",
    "for",
    "with",
    "a",
    "an",
    "to",
    "of",
    "in",
    "on",
    "and",
    "hello",
    "hi",
    "thanks",
    "thank",
    "please",
    "want",
    "would",
    "like",
    "how",
    "much",
    "what",
    "where",
    "when",
    "we",
    "i",
    "my",
    "tomorrow",
    "today",
    "there",
    "can",
    "it",
    "this",
    "that",
    "people",
    "be",
    "will",
    "any",
    "available",
    "price",
    "book",
    "but",
    "or",
    "our",
    "us",
    "yes",
    "good",
    "morning",
  ],
};

/** For each word, the languages that use it. */
const OWNERS: ReadonlyMap<string, readonly ContactLocale[]> = (() => {
  const owners = new Map<string, ContactLocale[]>();
  for (const locale of CONTACT_LOCALES) {
    for (const word of WORDS[locale]) {
      const list = owners.get(word) ?? [];
      if (!list.includes(locale)) list.push(locale);
      owners.set(word, list);
    }
  }
  return owners;
})();

/** Strong signs: worth this much each, alone. */
const SIGNS: ReadonlyArray<readonly [RegExp, ContactLocale, number]> = [
  [/[¿¡]/gu, "es", 2],
  [/ñ/gu, "es", 2],
  [/[ãõ]/gu, "pt-BR", 2],
  [/ç/gu, "pt-BR", 1.5],
];

function clean(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/gu, " ")
    .replace(/[@#][\p{L}\p{N}_.-]+/gu, " ");
}

/** The language of one message, or null when it does not decide. */
export function detectContactLocale(text: string): LocaleGuess | null {
  const body = clean(text);
  const words = body.match(/\p{L}+/gu) ?? [];
  const score: Record<ContactLocale, number> = { "pt-BR": 0, en: 0, es: 0 };
  let strong = false;

  for (const [pattern, locale, weight] of SIGNS) {
    const hits = body.match(pattern)?.length ?? 0;
    if (hits > 0) {
      strong = true;
      score[locale] += weight * Math.min(hits, 2);
    }
  }
  for (const word of words) {
    const owners = OWNERS.get(word);
    if (!owners) continue;
    for (const locale of owners) score[locale] += 1 / owners.length;
  }
  if (!strong && words.length < MIN_WORDS) return null;

  const ranked = CONTACT_LOCALES.map((locale) => ({
    locale,
    score: score[locale],
  })).sort((a, b) => b.score - a.score);
  const total = ranked.reduce((sum, item) => sum + item.score, 0);
  const best = ranked[0]!;
  if (total === 0 || best.score < MIN_SCORE) return null;
  const confidence = Math.round((best.score / total) * 100) / 100;
  if (confidence < MIN_CONFIDENCE) return null;
  return { locale: best.locale, confidence };
}

/** A workspace's language (`workspaces.default_locale`) among the three. */
export function contactLocaleOf(
  code: string | null | undefined,
): ContactLocale {
  if (code?.startsWith("en")) return "en";
  if (code?.startsWith("es")) return "es";
  return "pt-BR";
}
