import { keepsMessageArguments } from "../locales";

/**
 * Checks on what a machine translator returns (I6). The dashboard texts go
 * through the same rules as a manual edit (`saveText`): trimmed, 1 to 5000
 * characters, the same ICU arguments as the source and balanced braces. A
 * text that fails is skipped and counted, never saved.
 */

/** Keys per run of the texts job; the rest waits for the next run. */
export const MAX_KEYS_PER_RUN = 5000;
/** Texts per provider call. */
export const TEXTS_PER_CALL = 150;
/** Same limits as the columns of the translation tables. */
export const MAX_TEXT_LENGTH = 5000;
export const MAX_LEGAL_TITLE = 120;
export const MAX_LEGAL_BODY = 100_000;

/** The saved form of a machine text, or null when it must be skipped. */
export function acceptMachineText(
  source: string,
  output: unknown,
): string | null {
  if (typeof output !== "string") return null;
  const text = output.trim();
  if (text.length < 1 || text.length > MAX_TEXT_LENGTH) return null;
  return keepsMessageArguments(source, text) ? text : null;
}

/** The saved form of a machine legal translation, or null. */
export function acceptMachineDocument(
  output: Readonly<{ title?: unknown; body?: unknown }>,
): { title: string; body: string } | null {
  if (typeof output.title !== "string" || typeof output.body !== "string") {
    return null;
  }
  const title = output.title.trim();
  const body = output.body.trim();
  if (title.length < 1 || title.length > MAX_LEGAL_TITLE) return null;
  if (body.length < 1 || body.length > MAX_LEGAL_BODY) return null;
  return { title, body };
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error("Invalid size");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** Runs `fn` over `items` with at most `limit` calls at a time, in order. */
export async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      // After a failure no new call starts; the first error is thrown.
      while (!failed && next < items.length) {
        const index = next++;
        try {
          results[index] = await fn(items[index]!, index);
        } catch (error) {
          failed = true;
          throw error;
        }
      }
    },
  );
  await Promise.all(workers);
  return results;
}
