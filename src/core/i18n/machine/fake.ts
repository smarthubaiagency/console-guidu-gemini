import type {
  LanguageRef,
  LegalDocumentInput,
  MachineTranslator,
  TextEntry,
} from "./types";

/**
 * Deterministic translator for tests and e2e (`TRANSLATION_PROVIDER=fake`):
 * prefixes each word of human text with `[<code>]` and leaves ICU syntax
 * untouched (everything between braces stays as written, except the human
 * text of plural/select options, which is handled the same way). Never
 * calls a network.
 *
 * Test hooks: a source text containing `__fake_invalid__` comes back
 * without its arguments (the validation must skip it); one containing
 * `__fake_missing__` is left out of the answer.
 */
export const FAKE_INVALID_MARKER = "__fake_invalid__";
export const FAKE_MISSING_MARKER = "__fake_missing__";

/** Prefixes the words of plain text (outside `{...}` arguments). */
function prefixWords(text: string, tag: string): string {
  return text.replace(/[\p{L}][\p{L}\p{M}'’-]*/gu, (word) => `${tag}${word}`);
}

/**
 * Walks an ICU message: plain text gets prefixed; an argument `{name}` or
 * `{name, type, ...options {text}}` keeps its name, type and option keys,
 * and the option texts are walked again.
 */
export function fakeTranslate(text: string, code: string): string {
  const tag = `[${code}]`;
  let out = "";
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open < 0) {
      out += prefixWords(text.slice(i), tag);
      break;
    }
    out += prefixWords(text.slice(i, open), tag);
    // Find the matching close brace.
    let depth = 0;
    let close = open;
    for (; close < text.length; close++) {
      if (text[close] === "{") depth++;
      else if (text[close] === "}" && --depth === 0) break;
    }
    if (close >= text.length) {
      out += text.slice(open); // unbalanced: leave as is
      break;
    }
    out += fakeArgument(text.slice(open + 1, close), code);
    i = close + 1;
  }
  return out;
}

function fakeArgument(inner: string, code: string): string {
  const first = inner.indexOf(",");
  if (first < 0) return `{${inner}}`; // {name}
  const second = inner.indexOf(",", first + 1);
  if (second < 0) return `{${inner}}`; // {date, date}
  const head = inner.slice(0, second + 1);
  let rest = inner.slice(second + 1);
  let options = "";
  // `key {text}` pairs: keys stay, texts are translated recursively.
  while (rest.length > 0) {
    const open = rest.indexOf("{");
    if (open < 0) {
      options += rest;
      break;
    }
    options += rest.slice(0, open);
    let depth = 0;
    let close = open;
    for (; close < rest.length; close++) {
      if (rest[close] === "{") depth++;
      else if (rest[close] === "}" && --depth === 0) break;
    }
    options += `{${fakeTranslate(rest.slice(open + 1, close), code)}}`;
    rest = rest.slice(close + 1);
  }
  return `{${head}${options}}`;
}

export function createFakeTranslator(): MachineTranslator {
  return {
    provider: "fake",
    async translateTexts(
      _source: LanguageRef,
      target: LanguageRef,
      entries: readonly TextEntry[],
    ) {
      const out: Record<string, string> = {};
      for (const entry of entries) {
        if (entry.text.includes(FAKE_MISSING_MARKER)) continue;
        out[entry.key] = entry.text.includes(FAKE_INVALID_MARKER)
          ? prefixWords(entry.text.replace(/[{}]/g, ""), `[${target.code}]`)
          : fakeTranslate(entry.text, target.code);
      }
      return out;
    },
    async translateDocument(
      _source: LanguageRef,
      target: LanguageRef,
      document: LegalDocumentInput,
    ) {
      const tag = `[${target.code}]`;
      return {
        title: `${tag} ${document.title}`.slice(0, 120),
        body: document.body
          .split("\n")
          .map((line) => (line.trim() ? `${tag} ${line}` : line))
          .join("\n"),
      };
    },
  };
}
