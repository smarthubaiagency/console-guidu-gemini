/**
 * Body format of the editable e-mail templates (CF3b). Marcelo (14/10/2026):
 * a simple editor, never free HTML. The body is a small Markdown subset
 * parsed here into a closed tree and rendered by our own code, so no
 * user-written markup ever reaches an e-mail or the dashboard:
 *
 * - paragraphs split by a blank line; a single line break stays a break;
 * - `# `, `## `, `### ` headings; `- ` (or `* `) and `1. ` lists;
 * - `**bold**`, `*italic*`, `[label](https://...)` or `[label]({{link}})`;
 * - `{{tag}}` variables of the event, replaced by escaped values;
 * - `\` before a punctuation character keeps it literal.
 *
 * Pure and dependency-free: the worker, the server and the preview in the
 * browser share it.
 */

export type LinkTarget =
  | Readonly<{ kind: "url"; url: string }>
  | Readonly<{ kind: "tag"; name: string }>
  | Readonly<{ kind: "invalid"; raw: string }>;

export type Inline =
  | Readonly<{ type: "text"; value: string }>
  | Readonly<{ type: "tag"; name: string }>
  | Readonly<{ type: "break" }>
  | Readonly<{ type: "strong"; children: readonly Inline[] }>
  | Readonly<{ type: "em"; children: readonly Inline[] }>
  | Readonly<{
      type: "link";
      href: LinkTarget;
      children: readonly Inline[];
    }>;

export type Block =
  | Readonly<{ type: "paragraph"; children: readonly Inline[] }>
  | Readonly<{
      type: "heading";
      level: 1 | 2 | 3;
      children: readonly Inline[];
    }>
  | Readonly<{
      type: "list";
      ordered: boolean;
      items: readonly (readonly Inline[])[];
    }>;

/** A variable of an event: plain text, or a link usable as `href`. */
export type TemplateVariable = Readonly<{
  name: string;
  kind: "text" | "url";
}>;

export type TemplateValues = Readonly<Record<string, string>>;

export const SUBJECT_MAX = 200;
export const BODY_MAX = 10_000;

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

const PUNCT = /[!-/:-@[-`{-~]/;
const TAG_AT = /^\{\{([^{}]*)\}\}/;
const TAG_ONLY = /^\{\{([^{}]*)\}\}$/;
const TAG_ANY = /\{\{([^{}]*)\}\}/g;
const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^[-*]\s+(.*)$/;
const ORDERED = /^\d{1,3}[.)]\s+(.*)$/;

/** An absolute http(s) address with nothing that could break an attribute. */
export function isHttpUrl(value: string): boolean {
  if (!value || /[\s<>"'`\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function linkTarget(raw: string): LinkTarget {
  const tag = TAG_ONLY.exec(raw);
  if (tag) return { kind: "tag", name: (tag[1] ?? "").trim() };
  if (isHttpUrl(raw)) return { kind: "url", url: new URL(raw).toString() };
  return { kind: "invalid", raw };
}

type Context = Readonly<{ strong: boolean; em: boolean; link: boolean }>;

/** Index of the closing delimiter, skipping escapes; -1 when absent. */
function findClose(src: string, from: number, delim: "**" | "*" | "]") {
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === "\\" && i + 1 < src.length && PUNCT.test(src[i + 1]!)) {
      i++;
      continue;
    }
    if (delim === "**") {
      if (src.startsWith("**", i)) return i;
    } else if (delim === "*") {
      if (c === "*") {
        if (src[i + 1] === "*") {
          i++;
          continue;
        }
        return i;
      }
    } else if (c === "]") {
      return i;
    }
  }
  return -1;
}

/**
 * Inline content of one line. Each kind of span opens at most once per
 * nesting level, so a malformed text costs at most a few linear scans.
 */
function parseInline(src: string, ctx: Context): Inline[] {
  const out: Inline[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) out.push({ type: "text", value: buffer });
    buffer = "";
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === "\\" && i + 1 < src.length && PUNCT.test(src[i + 1]!)) {
      buffer += src[i + 1];
      i += 2;
      continue;
    }
    if (c === "{" && src[i + 1] === "{") {
      const tag = TAG_AT.exec(src.slice(i));
      if (tag) {
        flush();
        out.push({ type: "tag", name: (tag[1] ?? "").trim() });
        i += tag[0].length;
        continue;
      }
    }
    if (!ctx.strong && src.startsWith("**", i)) {
      const close = findClose(src, i + 2, "**");
      if (close > i + 2) {
        flush();
        out.push({
          type: "strong",
          children: parseInline(src.slice(i + 2, close), {
            ...ctx,
            strong: true,
          }),
        });
        i = close + 2;
        continue;
      }
    }
    if (!ctx.em && c === "*" && src[i + 1] !== "*") {
      const close = findClose(src, i + 1, "*");
      if (close > i + 1) {
        flush();
        out.push({
          type: "em",
          children: parseInline(src.slice(i + 1, close), { ...ctx, em: true }),
        });
        i = close + 1;
        continue;
      }
    }
    if (!ctx.link && c === "[") {
      const close = findClose(src, i + 1, "]");
      if (close > i + 1 && src[close + 1] === "(") {
        const end = src.indexOf(")", close + 2);
        if (end > close + 2) {
          flush();
          out.push({
            type: "link",
            href: linkTarget(src.slice(close + 2, end).trim()),
            children: parseInline(src.slice(i + 1, close), {
              ...ctx,
              link: true,
            }),
          });
          i = end + 1;
          continue;
        }
      }
    }
    buffer += c;
    i++;
  }
  flush();
  return out;
}

const ROOT: Context = { strong: false, em: false, link: false };

/** Parses a template body into blocks. Never throws. */
export function parseMarkup(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: Inline[][] } | null = null;

  const endParagraph = () => {
    if (paragraph.length === 0) return;
    const children: Inline[] = [];
    paragraph.forEach((line, index) => {
      if (index > 0) children.push({ type: "break" });
      children.push(...parseInline(line, ROOT));
    });
    blocks.push({ type: "paragraph", children });
    paragraph = [];
  };
  const endList = () => {
    if (list) blocks.push({ type: "list", ...list });
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      endParagraph();
      endList();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      endParagraph();
      endList();
      blocks.push({
        type: "heading",
        level: heading[1]!.length as 1 | 2 | 3,
        children: parseInline(heading[2] ?? "", ROOT),
      });
      continue;
    }
    const bullet = BULLET.exec(line);
    const ordered = bullet ? null : ORDERED.exec(line);
    const item = bullet ?? ordered;
    if (item) {
      endParagraph();
      const isOrdered = ordered !== null;
      if (list && list.ordered !== isOrdered) endList();
      list ??= { ordered: isOrdered, items: [] };
      list.items.push(parseInline(item[1] ?? "", ROOT));
      continue;
    }
    endList();
    paragraph.push(line);
  }
  endParagraph();
  endList();
  return blocks;
}

/**
 * Escapes a plain text so it reads literally in a body (used to turn the
 * code's default texts into a template).
 */
export function escapeMarkup(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const escaped = line.replace(/[\\*[\]{}]/g, (c) => `\\${c}`);
      return /^(#{1,3}\s|[-*]\s|\d{1,3}[.)]\s)/.test(escaped)
        ? escaped
            .replace(/^(\d{1,3})([.)])/, "$1\\$2")
            .replace(/^([#-])/, "\\$1")
        : escaped;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type TemplateIssueCode =
  | "required"
  | "too_long"
  | "newline"
  | "unknown_tag"
  | "bad_link"
  | "tag_not_link";

export type TemplateIssue = Readonly<{
  field: "subject" | "body";
  code: TemplateIssueCode;
  tag?: string;
}>;

function walkInlines(
  nodes: readonly Inline[],
  visit: (node: Inline) => void,
): void {
  for (const node of nodes) {
    visit(node);
    if ("children" in node) walkInlines(node.children, visit);
  }
}

function walkBlocks(
  blocks: readonly Block[],
  visit: (node: Inline) => void,
): void {
  for (const block of blocks) {
    if (block.type === "list") {
      block.items.forEach((item) => walkInlines(item, visit));
    } else {
      walkInlines(block.children, visit);
    }
  }
}

/**
 * Checks a template against its event's variables: required fields,
 * lengths, a single-line subject, known tags only, and links that are
 * http(s) or a link variable.
 */
export function validateTemplate(
  input: Readonly<{ subject: string; body: string }>,
  variables: readonly TemplateVariable[],
): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  const known = new Map(variables.map((v) => [v.name, v.kind]));
  const seen = new Set<string>();
  const add = (issue: TemplateIssue) => {
    const key = `${issue.field}:${issue.code}:${issue.tag ?? ""}`;
    if (!seen.has(key)) issues.push(issue);
    seen.add(key);
  };

  const subject = input.subject;
  if (!subject.trim()) add({ field: "subject", code: "required" });
  if (subject.length > SUBJECT_MAX) add({ field: "subject", code: "too_long" });
  if (/[\r\n]/.test(subject)) add({ field: "subject", code: "newline" });
  for (const match of subject.matchAll(TAG_ANY)) {
    const name = (match[1] ?? "").trim();
    if (!known.has(name))
      add({ field: "subject", code: "unknown_tag", tag: name });
  }

  const body = input.body;
  if (!body.trim()) add({ field: "body", code: "required" });
  if (body.length > BODY_MAX) add({ field: "body", code: "too_long" });
  walkBlocks(parseMarkup(body), (node) => {
    if (node.type === "tag" && !known.has(node.name)) {
      add({ field: "body", code: "unknown_tag", tag: node.name });
    }
    if (node.type === "link") {
      if (node.href.kind === "invalid")
        add({ field: "body", code: "bad_link" });
      if (node.href.kind === "tag") {
        const kind = known.get(node.href.name);
        if (!kind) {
          add({ field: "body", code: "unknown_tag", tag: node.href.name });
        } else if (kind !== "url") {
          add({ field: "body", code: "tag_not_link", tag: node.href.name });
        }
      }
    }
  });
  return issues;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** The subject with its tags replaced: one line, at most 200 characters. */
export function fillSubject(subject: string, values: TemplateValues): string {
  return subject
    .replace(TAG_ANY, (_, name: string) => values[name.trim()] ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, SUBJECT_MAX);
}

/** The address of a link, or null when it is not a safe http(s) one. */
export function resolveHref(
  href: LinkTarget,
  values: TemplateValues,
): string | null {
  if (href.kind === "url") return href.url;
  if (href.kind === "tag") {
    const value = values[href.name];
    return value && isHttpUrl(value) ? new URL(value).toString() : null;
  }
  return null;
}

function inlineText(nodes: readonly Inline[], values: TemplateValues): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
          return node.value;
        case "tag":
          return values[node.name] ?? "";
        case "break":
          return "\n";
        case "strong":
        case "em":
          return inlineText(node.children, values);
        case "link": {
          const label = inlineText(node.children, values);
          const href = resolveHref(node.href, values);
          if (!href || label === href) return label || (href ?? "");
          return label ? `${label} (${href})` : href;
        }
      }
    })
    .join("");
}

/** Plain-text version of a body. */
export function renderMarkupText(
  blocks: readonly Block[],
  values: TemplateValues,
): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case "heading":
          return inlineText(block.children, values);
        case "paragraph": {
          // A paragraph that is only a link reads as `label: address`.
          const [only] = block.children;
          if (block.children.length === 1 && only?.type === "link") {
            const href = resolveHref(only.href, values);
            const label = inlineText(only.children, values);
            if (href && label && label !== href) return `${label}: ${href}`;
          }
          return inlineText(block.children, values);
        }
        case "list":
          return block.items
            .map(
              (item, index) =>
                `${block.ordered ? `${index + 1}.` : "-"} ${inlineText(item, values)}`,
            )
            .join("\n");
      }
    })
    .join("\n\n");
}

export type HtmlOptions = Readonly<{
  /** Brand color of links and headings: `#rrggbb` only. */
  color?: string | null;
}>;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function safeColor(color: string | null | undefined): string | null {
  return color && HEX_COLOR.test(color) ? color : null;
}

function inlineHtml(
  nodes: readonly Inline[],
  values: TemplateValues,
  color: string | null,
): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
          return escapeHtml(node.value);
        case "tag":
          return escapeHtml(values[node.name] ?? "");
        case "break":
          return "<br>";
        case "strong":
          return `<strong>${inlineHtml(node.children, values, color)}</strong>`;
        case "em":
          return `<em>${inlineHtml(node.children, values, color)}</em>`;
        case "link": {
          const label = inlineHtml(node.children, values, color);
          const href = resolveHref(node.href, values);
          if (!href) return label;
          const style = color ? ` style="color:${color}"` : "";
          return `<a href="${escapeHtml(href)}"${style}>${label || escapeHtml(href)}</a>`;
        }
      }
    })
    .join("");
}

/** HTML version of a body: only the tags this function writes. */
export function renderMarkupHtml(
  blocks: readonly Block[],
  values: TemplateValues,
  options: HtmlOptions = {},
): string {
  const color = safeColor(options.color);
  return blocks
    .map((block) => {
      switch (block.type) {
        case "heading": {
          const style = color ? ` style="color:${color}"` : "";
          return `<h${block.level}${style}>${inlineHtml(block.children, values, color)}</h${block.level}>`;
        }
        case "paragraph":
          return `<p>${inlineHtml(block.children, values, color)}</p>`;
        case "list": {
          const tag = block.ordered ? "ol" : "ul";
          const items = block.items
            .map((item) => `<li>${inlineHtml(item, values, color)}</li>`)
            .join("");
          return `<${tag}>${items}</${tag}>`;
        }
      }
    })
    .join("\n");
}
