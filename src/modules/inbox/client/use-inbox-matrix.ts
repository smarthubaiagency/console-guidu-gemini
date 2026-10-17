"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk";

import {
  clearSession,
  readSession,
  type StoredSession,
  writeSession,
} from "./session-store";

/**
 * The attendant's Matrix client (IN4a, ADR 0023 rules 4, 9 and 10). The
 * browser talks to Synapse with the attendant's own session: the console
 * hands a 60-second JWT (`POST /api/matrix/session`) that is exchanged for
 * a session with a refresh token, kept in the browser. The list of all the
 * rooms and the open room come from Sliding Sync (the open room is a room
 * subscription with its timeline and full state); the views and the search
 * come from the mirror in the database.
 */

export const CONVERSATION_STATE = "chat.guidu.conversation";

export type MatrixPhase = "connecting" | "ready" | "error";

/** One login per page load: React runs effects twice in development. */
let pending: Promise<StoredSession> | null = null;

async function login(): Promise<StoredSession> {
  const response = await fetch("/api/matrix/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error(`session ${response.status}`);
  const session = (await response.json()) as {
    homeserverUrl: string;
    userId: string;
    loginToken: string;
  };
  const logged = await fetch(
    `${session.homeserverUrl}/_matrix/client/v3/login`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "org.matrix.login.jwt",
        token: session.loginToken,
        refresh_token: true,
        initial_device_display_name: "Inbox",
      }),
    },
  );
  if (!logged.ok) throw new Error(`login ${logged.status}`);
  const body = (await logged.json()) as {
    user_id: string;
    access_token: string;
    device_id: string;
    refresh_token?: string;
  };
  const stored: StoredSession = {
    homeserverUrl: session.homeserverUrl,
    userId: body.user_id,
    deviceId: body.device_id,
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
  };
  writeSession(stored);
  return stored;
}

function obtainSession(expectedUserId: string | null): Promise<StoredSession> {
  const stored = readSession();
  if (stored && (expectedUserId === null || stored.userId === expectedUserId)) {
    return Promise.resolve(stored);
  }
  pending ??= login().finally(() => {
    pending = null;
  });
  return pending;
}

type SlidingSyncLike = {
  modifyRoomSubscriptions(rooms: Set<string>): void;
  stop(): void;
};

export type InboxMatrix = Readonly<{
  phase: MatrixPhase;
  client: MatrixClient | null;
  userId: string | null;
  /** Changes whenever something of the rooms changed, to re-render. */
  revision: number;
  /** Subscribes the open room (timeline and full state). */
  open(roomId: string | null): void;
}>;

export function useInboxMatrix(expectedUserId: string | null): InboxMatrix {
  const [phase, setPhase] = useState<MatrixPhase>("connecting");
  const [client, setClient] = useState<MatrixClient | null>(null);
  const [revision, setRevision] = useState(0);
  const slidingRef = useRef<SlidingSyncLike | null>(null);
  const openRef = useRef<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let current: MatrixClient | null = null;
    let frame = 0;
    const bump = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setRevision((value) => value + 1);
      });
    };

    const start = async (retry: boolean): Promise<void> => {
      const sdk = await import("matrix-js-sdk");
      const { SlidingSync } = await import("matrix-js-sdk/lib/sliding-sync.js");
      const session = await obtainSession(expectedUserId);
      if (stopped) return;
      const matrix = sdk.createClient({
        baseUrl: session.homeserverUrl,
        userId: session.userId,
        deviceId: session.deviceId,
        accessToken: session.accessToken,
        ...(session.refreshToken
          ? {
              refreshToken: session.refreshToken,
              onTokenRefresh: (tokens: {
                accessToken: string;
                refreshToken?: string;
              }) =>
                writeSession({
                  ...session,
                  accessToken: tokens.accessToken,
                  refreshToken: tokens.refreshToken ?? session.refreshToken,
                }),
            }
          : {}),
      });
      try {
        await matrix.whoami();
      } catch (error) {
        // A session ended by the console's sign-out (or expired): log in
        // again once with a new JWT.
        clearSession();
        if (retry) return start(false);
        throw error;
      }
      if (stopped) return;
      current = matrix;
      matrix.on(sdk.ClientEvent.Room, bump);
      matrix.on(sdk.RoomEvent.Timeline, bump);
      matrix.on(sdk.RoomEvent.Receipt, bump);
      matrix.on(sdk.RoomStateEvent.Events, bump);
      matrix.on(sdk.RoomMemberEvent.Typing, bump);
      matrix.on(sdk.HttpApiEvent.SessionLoggedOut, () => {
        clearSession();
        setPhase("error");
      });
      const sliding = new SlidingSync(
        session.homeserverUrl,
        new Map([
          [
            "conversations",
            {
              ranges: [[0, 99]],
              sort: ["by_recency"],
              timeline_limit: 1,
              required_state: [
                [CONVERSATION_STATE, ""],
                ["m.room.power_levels", ""],
              ],
            },
          ],
        ]),
        {
          timeline_limit: 50,
          required_state: [["*", "*"]],
        },
        matrix,
        30_000,
      );
      slidingRef.current = sliding as unknown as SlidingSyncLike;
      if (openRef.current) {
        sliding.modifyRoomSubscriptions(new Set([openRef.current]));
      }
      setClient(matrix);
      await matrix.startClient({ slidingSync: sliding });
      if (stopped) return;
      setPhase("ready");
      matrix.setPresence({ presence: "online" }).catch(() => undefined);
      bump();
    };

    start(true).catch(() => {
      if (!stopped) setPhase("error");
    });

    return () => {
      stopped = true;
      if (frame) window.cancelAnimationFrame(frame);
      slidingRef.current?.stop();
      slidingRef.current = null;
      current?.stopClient();
    };
  }, [expectedUserId]);

  const open = useCallback((roomId: string | null) => {
    openRef.current = roomId;
    slidingRef.current?.modifyRoomSubscriptions(
      new Set(roomId ? [roomId] : []),
    );
  }, []);

  return {
    phase,
    client,
    userId: client?.getUserId() ?? null,
    revision,
    open,
  };
}
