/**
 * Languages of the dashboard (I1). pt-BR is the source: every text is
 * written first in Portuguese, in `src/i18n/messages/pt-BR.json`. The
 * languages shipped with the code have their own file; a language added in
 * Plataforma › Configurações › Idiomas starts from the source texts and is
 * translated there.
 */

export const SOURCE_LOCALE = "pt-BR";

/** Languages with a messages file in the code. */
export const BUILT_IN_LOCALES = ["pt-BR", "en", "es"] as const;
export type BuiltInLocale = (typeof BUILT_IN_LOCALES)[number];

/** BCP 47 code: language and optional region (pt-BR, en, es-MX). */
export const LOCALE_CODE = /^[a-z]{2,3}(-[A-Z][A-Za-z0-9]{1,7})?$/;

/** Message key: dotted path of letters, digits, `_` and `-`. */
export const MESSAGE_KEY = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;

export function isBuiltInLocale(code: string): code is BuiltInLocale {
  return (BUILT_IN_LOCALES as readonly string[]).includes(code);
}

/**
 * Best available language for an Accept-Language header: exact match,
 * then the same base language (`es-AR` -> `es`, `pt` -> `pt-BR`).
 */
export function negotiateLocale(
  acceptLanguage: string | null | undefined,
  available: readonly string[],
): string | null {
  if (!acceptLanguage) return null;
  const wanted = acceptLanguage
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return {
        tag: tag.trim(),
        q: q ? Number(q.slice(2)) || 0 : 1,
        index,
      };
    })
    .filter((w) => w.tag && w.tag !== "*" && w.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const { tag } of wanted) {
    const lower = tag.toLowerCase();
    const exact = available.find((code) => code.toLowerCase() === lower);
    if (exact) return exact;
    const base = lower.split("-")[0];
    const sameBase = available.find(
      (code) => code.toLowerCase().split("-")[0] === base,
    );
    if (sameBase) return sameBase;
  }
  return null;
}

/**
 * Language of a request, in order: the person's choice, the default of the
 * workspace (dashboard), the browser (visitors only), the platform default.
 */
export function chooseLocale(
  candidates: Readonly<{
    user?: string | null;
    workspace?: string | null;
    browser?: string | null;
    platformDefault: string;
  }>,
  active: readonly string[],
): string {
  for (const code of [
    candidates.user,
    candidates.workspace,
    candidates.browser,
  ]) {
    if (code && active.includes(code)) return code;
  }
  return candidates.platformDefault;
}

export type Messages = { [key: string]: string | Messages };

/** `{ a: { b: "x" } }` -> `{ "a.b": "x" }`. */
export function flattenMessages(
  messages: Messages,
  prefix = "",
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(messages)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[path] = value;
    else Object.assign(out, flattenMessages(value, path));
  }
  return out;
}

/** `{ "a.b": "x" }` -> `{ a: { b: "x" } }`; keys that clash are skipped. */
export function unflattenMessages(flat: Record<string, string>): Messages {
  const out: Messages = {};
  for (const [path, value] of Object.entries(flat)) {
    const parts = path.split(".");
    let node: Messages = out;
    let clash = false;
    for (const part of parts.slice(0, -1)) {
      const next = node[part];
      if (typeof next === "string") {
        clash = true;
        break;
      }
      node = (node[part] ??= {}) as Messages;
    }
    const leaf = parts.at(-1)!;
    if (!clash && typeof node[leaf] !== "object") node[leaf] = value;
  }
  return out;
}

/**
 * Messages of a language: the source texts, then the language's file, then
 * the platform edits. Only keys of the source exist, so an edit or a file
 * entry for a removed key is ignored.
 */
export function mergeMessages(
  source: Messages,
  file: Messages | null,
  edits: Readonly<Record<string, string>>,
): Messages {
  const base = flattenMessages(source);
  const fromFile = file ? flattenMessages(file) : {};
  const merged: Record<string, string> = {};
  for (const key of Object.keys(base)) {
    merged[key] = edits[key] ?? fromFile[key] ?? base[key]!;
  }
  return unflattenMessages(merged);
}

/** `{name}`-style arguments of a message (ICU), sorted and unique. */
export function messageArguments(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/\{\s*([A-Za-z0-9_]+)\s*[,}]/g)) {
    names.add(match[1]!);
  }
  return [...names].sort();
}

export function balancedBraces(text: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/**
 * A translation keeps the ICU arguments of its source and balanced braces
 * (I1 manual edits, I6 machine translation): the dashboard fills the same
 * arguments, and a lost `{count}` would break the text.
 */
export function keepsMessageArguments(source: string, text: string): boolean {
  return (
    balancedBraces(text) &&
    messageArguments(text).join() === messageArguments(source).join()
  );
}
