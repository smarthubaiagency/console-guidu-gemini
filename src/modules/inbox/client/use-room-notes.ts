"use client";

import { useCallback, useEffect, useState } from "react";

import { listNotesAction } from "../notes-actions";
import type { InboxNoteView } from "../server/notes";

/** How often the notes of the open conversation are asked again. */
const REFRESH_MS = 8_000;

/**
 * The private notes of the open conversation (IN5a), from the database:
 * asked when the conversation opens, after each change and from time to
 * time (notes of the colleagues). An answer for another room is dropped.
 */
export function useRoomNotes(
  workspaceSlug: string,
  roomId: string | null,
): Readonly<{ notes: readonly InboxNoteView[]; refresh: () => Promise<void> }> {
  const [state, setState] = useState<{
    roomId: string;
    notes: InboxNoteView[];
  } | null>(null);

  const refresh = useCallback(async () => {
    if (!roomId) return;
    const result = await listNotesAction({ workspaceSlug, roomId });
    if ("notes" in result) setState({ roomId, notes: result.notes });
  }, [workspaceSlug, roomId]);

  useEffect(() => {
    if (!roomId) return;
    const timer = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [roomId, refresh]);

  return {
    notes: state && state.roomId === roomId ? state.notes : EMPTY,
    refresh,
  };
}

const EMPTY: readonly InboxNoteView[] = [];
