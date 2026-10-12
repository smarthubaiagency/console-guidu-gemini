import { z } from "zod";

import { AppError } from "@/shared/errors";

// ---------------------------------------------------------------------------
// Cursor pagination (created_at desc, id desc)
// ---------------------------------------------------------------------------

// The cursor keeps the timestamp as Postgres prints it (microseconds);
// a JavaScript Date would cut it to milliseconds and skip rows.
const Cursor = z.object({
  t: z.string().regex(/^\d{4}-\d{2}-\d{2}[ T][\d:.]+([+-]\d{2}(:?\d{2})?|Z)$/),
  id: z.string().uuid(),
});
type CursorValue = z.infer<typeof Cursor>;

export function encodeCursor(row: CursorValue): string {
  return Buffer.from(JSON.stringify({ t: row.t, id: row.id })).toString(
    "base64url",
  );
}

export function decodeCursor(value: string | undefined): CursorValue | null {
  if (!value) return null;
  try {
    const parsed = Cursor.safeParse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
    if (parsed.success) return parsed.data;
  } catch {
    // falls through to the error below
  }
  throw new AppError({
    code: "invalid_input",
    safeMessage: "Cursor inválido.",
    messageKey: "apiErrors.invalidCursor",
  });
}

export function pageOf<T extends { cursor_t: string; cursor_id: string }>(
  rows: T[],
  limit: number,
) {
  const more = rows.length > limit;
  const items = more ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor:
      more && last
        ? encodeCursor({ t: last.cursor_t, id: last.cursor_id })
        : null,
  };
}
