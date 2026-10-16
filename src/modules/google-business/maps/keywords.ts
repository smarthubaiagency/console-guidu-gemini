/**
 * Keywords the agent picks for the map (GB1b, especificação §7.3): three,
 * from the category of the profile, adjustable afterwards. Deterministic
 * (no AI): the main category, the same with the "near me" intent of the
 * language, and an additional category or the category with the city.
 * Pattern of the multi-keyword grid of `AgriciDaniel/claude-seo` (MIT,
 * `skills/seo/references/maps-geo-grid.md`).
 */

export type KeywordLanguage = "pt" | "es" | "en";

const SPANISH = new Set([
  "ES",
  "MX",
  "AR",
  "CO",
  "CL",
  "PE",
  "UY",
  "PY",
  "BO",
  "EC",
  "VE",
  "CR",
  "PA",
  "DO",
  "GT",
  "HN",
  "SV",
  "NI",
  "CU",
  "PR",
]);

/** Language of the searches from the country of the unit (default pt). */
export function languageOfCountry(
  countryCode: string | null | undefined,
): KeywordLanguage {
  const code = countryCode?.trim().toUpperCase();
  if (
    !code ||
    code === "BR" ||
    code === "PT" ||
    code === "AO" ||
    code === "MZ"
  ) {
    return "pt";
  }
  if (SPANISH.has(code)) return "es";
  return "en";
}

const NEAR_ME: Record<KeywordLanguage, string> = {
  pt: "perto de mim",
  es: "cerca de mí",
  en: "near me",
};

export const KEYWORD_MIN = 2;
export const KEYWORD_MAX = 80;

/**
 * A category as a search: "gcid:dental_clinic" → "dental clinic";
 * "Dentista" → "dentista". Null when nothing usable is left.
 */
export function categoryAsKeyword(
  category: string | null | undefined,
): string | null {
  if (!category) return null;
  const text = category
    .replace(/^gcid:/i, "")
    .replace(/^categories\/[^:]*:?/i, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return text.length >= KEYWORD_MIN ? text.slice(0, KEYWORD_MAX) : null;
}

export function normalizeKeyword(keyword: string): string {
  return keyword.replace(/\s+/g, " ").trim().toLowerCase();
}

export function suggestKeywords(
  input: Readonly<{
    primaryCategory: string | null;
    additionalCategories: readonly string[];
    locality: string | null;
    language: KeywordLanguage;
  }>,
  count = 3,
): string[] {
  const primary = categoryAsKeyword(input.primaryCategory);
  const additional = input.additionalCategories
    .map((category) => categoryAsKeyword(category))
    .filter((value): value is string => value !== null);
  const locality = input.locality?.trim().toLowerCase() || null;

  const candidates: string[] = [];
  if (primary) {
    candidates.push(primary);
    candidates.push(`${primary} ${NEAR_ME[input.language]}`);
  }
  candidates.push(...additional);
  if (primary && locality) candidates.push(`${primary} ${locality}`);

  const seen = new Set<string>();
  const picked: string[] = [];
  for (const candidate of candidates) {
    const keyword = normalizeKeyword(candidate).slice(0, KEYWORD_MAX);
    if (keyword.length < KEYWORD_MIN || seen.has(keyword)) continue;
    seen.add(keyword);
    picked.push(keyword);
    if (picked.length >= count) break;
  }
  return picked;
}
