import type { GlossaryEntry } from "./types";

/**
 * The glossary of the translation (TR2, traducao.md §3.5): up to 200 lines,
 * each a term kept as it is ("Geribá") or a term with a fixed translation
 * ("check-in = entrada"). The AI engine reads it in the prompt; Google
 * Basic has no glossary, so its terms go marked as not translatable in the
 * HTML format and come back as they went.
 */

export const MAX_GLOSSARY_LINES = 200;
export const MAX_GLOSSARY_TERM = 80;

/** Reads the lines typed in the settings; invalid lines are left out. */
export function parseGlossary(raw: string): GlossaryEntry[] {
  const out: GlossaryEntry[] = [];
  const seen = new Set<string>();
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const at = trimmed.indexOf("=");
    const term = (at === -1 ? trimmed : trimmed.slice(0, at)).trim();
    const translation = at === -1 ? null : trimmed.slice(at + 1).trim() || null;
    if (
      !term ||
      term.length > MAX_GLOSSARY_TERM ||
      (translation !== null && translation.length > MAX_GLOSSARY_TERM)
    ) {
      continue;
    }
    const key = term.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ term, translation });
    if (out.length === MAX_GLOSSARY_LINES) break;
  }
  return out;
}

/** The glossary as the settings show it, one line per entry. */
export function formatGlossary(entries: readonly GlossaryEntry[]): string {
  return entries
    .map((entry) =>
      entry.translation ? `${entry.term} = ${entry.translation}` : entry.term,
    )
    .join("\n");
}

/** The glossary in the prompt of the AI engine (data, one per line). */
export function glossaryPrompt(entries: readonly GlossaryEntry[]): string {
  return entries
    .map((entry) =>
      entry.translation
        ? `- "${entry.term}" → "${entry.translation}"`
        : `- "${entry.term}" (keep as it is)`,
    )
    .join("\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function unescapeHtml(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/giu,
    (match, code: string) => {
      if (code[0] === "#") {
        const point =
          code[1] === "x" || code[1] === "X"
            ? Number.parseInt(code.slice(2), 16)
            : Number.parseInt(code.slice(1), 10);
        return Number.isFinite(point) && point > 0 && point <= 0x10ffff
          ? String.fromCodePoint(point)
          : match;
      }
      return ENTITIES[code.toLowerCase()] ?? match;
    },
  );
}

const KEEP_OPEN = '<span translate="no">';
const KEEP_CLOSE = "</span>";

/**
 * The text in the HTML format of Google Basic: escaped, line breaks as
 * `<br>`, each term of the glossary wrapped as not translatable (a term
 * with a fixed translation goes already translated).
 */
export function protectForHtml(
  text: string,
  entries: readonly GlossaryEntry[],
): string {
  const escaped = escapeHtml(text);
  const terms = [...entries]
    .filter((entry) => entry.term.trim())
    .sort((a, b) => b.term.length - a.term.length);
  let html = escaped;
  if (terms.length > 0) {
    const byKey = new Map(
      terms.map((entry) => [
        escapeHtml(entry.term).toLocaleLowerCase(),
        entry.translation,
      ]),
    );
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}])(${terms
        .map((entry) => escapeRegExp(escapeHtml(entry.term)))
        .join("|")})(?![\\p{L}\\p{N}])`,
      "giu",
    );
    html = escaped.replace(pattern, (match: string) => {
      const fixed = byKey.get(match.toLocaleLowerCase());
      return `${KEEP_OPEN}${fixed ? escapeHtml(fixed) : match}${KEEP_CLOSE}`;
    });
  }
  return html.replace(/\r?\n/gu, "<br>");
}

/** The answer of Google back to plain text. */
export function plainFromHtml(html: string): string {
  return unescapeHtml(
    html
      .replace(/<br\s*\/?>/giu, "\n")
      .replace(/<span translate="no">/giu, "")
      .replace(/<\/span>/giu, ""),
  ).trim();
}
