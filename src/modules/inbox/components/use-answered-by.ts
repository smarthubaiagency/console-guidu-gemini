"use client";

import { useEffect, useMemo, useState } from "react";

import { loadAnsweredByAction } from "../answered-actions";
import { agentEventIds, type TimelineMessage } from "../client/room-data";

/** The row is written right after the answer is sent: ask again a bit later. */
const FOLLOW_UPS_MS = [1_500, 5_000, 15_000];
const MAX_IDS = 100;

type Role = "attendant" | "seller";

/**
 * Which specialist wrote each answer of the GUIDS in view (GF2), read from
 * the database for the events a GUIDS sent. The room itself never says.
 */
export function useAnsweredBy(
  workspaceSlug: string,
  roomId: string | null,
  messages: readonly Pick<TimelineMessage, "id" | "sender">[],
): ReadonlyMap<string, Role> {
  const [state, setState] = useState<{
    roomId: string | null;
    byEvent: ReadonlyMap<string, Role>;
  }>({ roomId: null, byEvent: new Map() });
  const ids = useMemo(() => agentEventIds(messages).slice(-MAX_IDS), [messages]);
  const key = ids.join(",");

  useEffect(() => {
    if (!roomId || !key) return;
    let stopped = false;
    const read = async () => {
      const result = await loadAnsweredByAction({
        workspaceSlug,
        roomId,
        eventIds: key.split(","),
      }).catch(() => null);
      if (stopped || !result || "error" in result) return;
      setState({
        roomId,
        byEvent: new Map(result.answers.map((a) => [a.eventId, a.role])),
      });
    };
    void read();
    const timers = FOLLOW_UPS_MS.map((ms) => window.setTimeout(read, ms));
    return () => {
      stopped = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [workspaceSlug, roomId, key]);

  return state.roomId === roomId ? state.byEvent : new Map();
}
