"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MatrixClient, Room } from "matrix-js-sdk";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * PROVA DE CONCEITO (IN1). Cliente Matrix cru no navegador do atendente:
 * login JWT, lista de salas (sync clássico ou Sliding Sync, `?sync=sliding`),
 * timeline, envio e o state event `chat.guidu.conversation`. Sem o
 * chatbot-template, sem sidebar-09 e sem `useStatus()`: é só para provar a
 * arquitetura. A IN4 constrói a janela de verdade.
 */

const CONVERSATION_STATE = "chat.guidu.conversation";

type Conversation = { status: string; assignee: string | null };

type View = {
  rooms: { id: string; name: string; last: string; ts: number; status: string }[];
  timeline: { id: string; sender: string; body: string; ts: number }[];
  conversation: Conversation | null;
  encrypted: boolean;
};

const EMPTY: View = { rooms: [], timeline: [], conversation: null, encrypted: false };

type Login = { homeserverUrl: string; access_token: string; user_id: string; device_id: string };

/**
 * Um login por carga da página: o React de dev monta o efeito duas vezes, e
 * o Synapse limita logins por IP (`rc_login`, padrão 3 seguidos).
 */
let pendingLogin: { slug: string; promise: Promise<Login> } | null = null;

function loginOnce(slug: string): Promise<Login> {
  if (pendingLogin?.slug === slug) return pendingLogin.promise;
  const promise = (async () => {
    const sdk = await import("matrix-js-sdk");
    const session = await fetch("/api/matrix/poc/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceSlug: slug }),
    });
    if (!session.ok) throw new Error(`sessão: HTTP ${session.status}`);
    const { homeserverUrl, jwt } = (await session.json()) as { homeserverUrl: string; jwt: string };
    const anonymous = sdk.createClient({ baseUrl: homeserverUrl });
    const login = await anonymous.loginRequest({
      type: "org.matrix.login.jwt",
      token: jwt,
    } as Parameters<typeof anonymous.loginRequest>[0]);
    return { homeserverUrl, ...login } as Login;
  })();
  pendingLogin = { slug, promise };
  return promise;
}

function lastMessage(room: Room): { body: string; ts: number } {
  const events = room.getLiveTimeline().getEvents();
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    if (event.getType() === "m.room.message") {
      return { body: String(event.getContent().body ?? ""), ts: event.getTs() };
    }
  }
  return { body: "", ts: events.at(-1)?.getTs() ?? 0 };
}

function conversationOf(room: Room): Conversation | null {
  const event = room.currentState.getStateEvents(CONVERSATION_STATE, "");
  return event ? (event.getContent() as Conversation) : null;
}

export function InboxPoc({
  workspaceSlug,
  mode,
}: {
  workspaceSlug: string;
  mode: "classic" | "sliding";
}) {
  const clientRef = useRef<MatrixClient | null>(null);
  // Sliding Sync: a sala aberta vira uma assinatura (timeline e estado completos).
  const slidingRef = useRef<{ modifyRoomSubscriptions(rooms: Set<string>): Promise<unknown> } | null>(null);
  const [me, setMe] = useState<string>("");
  const [phase, setPhase] = useState("entrando");
  const [firstListMs, setFirstListMs] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>(EMPTY);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;

  const refresh = useCallback(() => {
    const client = clientRef.current;
    if (!client) return;
    const rooms = client
      .getRooms()
      .filter((room) => room.getMyMembership() === "join")
      .map((room) => {
        const last = lastMessage(room);
        return {
          id: room.roomId,
          name: room.name,
          last: last.body,
          ts: last.ts,
          status: conversationOf(room)?.status ?? "—",
        };
      })
      .sort((a, b) => b.ts - a.ts);
    const room = selectedRef.current ? client.getRoom(selectedRef.current) : null;
    setView({
      rooms,
      timeline: room
        ? room
            .getLiveTimeline()
            .getEvents()
            .filter((event) => event.getType() === "m.room.message")
            .map((event) => ({
              id: event.getId() ?? "",
              sender: event.getSender() ?? "",
              body: String(event.getContent().body ?? ""),
              ts: event.getTs(),
            }))
        : [],
      conversation: room ? conversationOf(room) : null,
      encrypted: room ? !!room.currentState.getStateEvents("m.room.encryption", "") : false,
    });
  }, []);

  useEffect(() => {
    let stopped = false;
    // Medido do início do sync (depois do login) até a primeira lista.
    let started = performance.now();
    (async () => {
      try {
        const sdk = await import("matrix-js-sdk");
        const login = await loginOnce(workspaceSlug);
        const homeserverUrl = login.homeserverUrl;
        if (stopped) return;
        const client = sdk.createClient({
          baseUrl: homeserverUrl,
          accessToken: login.access_token,
          userId: login.user_id,
          deviceId: login.device_id,
        });
        clientRef.current = client;
        setMe(login.user_id);
        setPhase(mode === "sliding" ? "sliding sync" : "sync clássico");
        const markFirst = () => {
          setFirstListMs((value) => value ?? Math.round(performance.now() - started));
          refresh();
        };
        client.on(sdk.ClientEvent.Room, refresh);
        client.on(sdk.RoomEvent.Timeline, refresh);
        client.on(sdk.RoomStateEvent.Events, refresh);
        if (mode === "sliding") {
          const { SlidingSync, SlidingSyncEvent } = await import(
            "matrix-js-sdk/lib/sliding-sync.js"
          );
          const sliding = new SlidingSync(
            homeserverUrl,
            new Map([
              [
                "conversas",
                {
                  ranges: [[0, 49]],
                  sort: ["by_recency"],
                  timeline_limit: 1,
                  required_state: [
                    ["m.room.name", ""],
                    ["m.room.encryption", ""],
                    [CONVERSATION_STATE, ""],
                  ],
                },
              ],
            ]),
            { timeline_limit: 30, required_state: [["*", "*"]] },
            client,
            30000,
          );
          slidingRef.current = sliding;
          sliding.once(SlidingSyncEvent.Lifecycle, markFirst);
          started = performance.now();
          await client.startClient({ slidingSync: sliding });
        } else {
          client.once(sdk.ClientEvent.Sync, markFirst);
          started = performance.now();
          await client.startClient({ initialSyncLimit: 20 });
        }
      } catch (caught) {
        setError(String(caught));
      }
    })();
    return () => {
      stopped = true;
      clientRef.current?.stopClient();
    };
  }, [workspaceSlug, mode, refresh]);

  useEffect(() => {
    if (selected && slidingRef.current) {
      void slidingRef.current.modifyRoomSubscriptions(new Set([selected]));
    }
    refresh();
  }, [selected, refresh]);

  const send = async () => {
    const client = clientRef.current;
    if (!client || !selected || !draft.trim()) return;
    await client.sendTextMessage(selected, draft.trim());
    setDraft("");
  };

  const setStatus = async (status: string, assignee: string | null) => {
    const client = clientRef.current;
    if (!client || !selected) return;
    await client.sendStateEvent(
      selected,
      CONVERSATION_STATE as Parameters<MatrixClient["sendStateEvent"]>[1],
      { version: 1, status, assignee } as never,
      "",
    );
  };

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center gap-3 border-b px-4 py-2 text-sm">
        <strong>Inbox (prova IN1)</strong>
        <Badge variant="outline">{workspaceSlug}</Badge>
        <span data-testid="me">{me || "…"}</span>
        <Badge variant="secondary">{phase}</Badge>
        <span data-testid="first-list">
          primeira lista: {firstListMs === null ? "…" : `${firstListMs} ms`}
        </span>
        <span>salas: {view.rooms.length}</span>
        {error ? <span className="text-destructive">{error}</span> : null}
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="w-80 overflow-y-auto border-r" data-testid="rooms">
          {view.rooms.map((room) => (
            <button
              key={room.id}
              data-room-id={room.id}
              type="button"
              onClick={() => setSelected(room.id)}
              className={`block w-full border-b px-3 py-2 text-left text-sm ${
                room.id === selected ? "bg-muted" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{room.name}</span>
                <Badge variant="outline">{room.status}</Badge>
              </div>
              <div className="truncate text-muted-foreground">{room.last}</div>
            </button>
          ))}
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          {selected ? (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-sm">
                <span>
                  status: <strong data-testid="status">{view.conversation?.status ?? "—"}</strong>
                </span>
                <span>
                  responsável: <strong>{view.conversation?.assignee ?? "ninguém"}</strong>
                </span>
                <Badge variant={view.encrypted ? "destructive" : "secondary"}>
                  E2EE: {view.encrypted ? "sim" : "não"}
                </Badge>
                <Button size="sm" onClick={() => setStatus("open", me)}>
                  Assumir
                </Button>
                <Button size="sm" variant="outline" onClick={() => setStatus("pending", null)}>
                  Devolver ao agente
                </Button>
                <Button size="sm" variant="outline" onClick={() => setStatus("resolved", me)}>
                  Resolver
                </Button>
              </div>
              <ol className="flex-1 space-y-2 overflow-y-auto p-4 text-sm" data-testid="timeline">
                {view.timeline.map((item) => (
                  <li key={item.id}>
                    <span className="text-muted-foreground">{item.sender}</span>
                    <div className={item.sender === me ? "font-medium" : ""}>{item.body}</div>
                  </li>
                ))}
              </ol>
              <form
                className="flex gap-2 border-t p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
              >
                <Input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Escreva uma mensagem"
                  aria-label="Mensagem"
                />
                <Button type="submit">Enviar</Button>
              </form>
            </>
          ) : (
            <p className="p-6 text-sm text-muted-foreground">Escolha uma conversa.</p>
          )}
        </main>
      </div>
    </div>
  );
}
