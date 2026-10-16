import "server-only";

import { answerAsPocAgent } from "./agent";
import type { MatrixPocConfig } from "./config";
import {
  addAttendantToRoom,
  agentUserId,
  createConversationRoom,
  ensureVirtualUser,
  matrixFetch,
  readConversationState,
  sendText,
  setTyping,
  writeConversationState,
} from "./homeserver";
import { readStore, updateStore } from "./store";

/**
 * PROVA DE CONCEITO (IN1). O que o núcleo faz com uma transação do
 * Application Service. Roda depois da resposta ao Synapse (`after()` no
 * route handler); na IN3 isso vira evento gravado + job no worker
 * (ADR 0011, regras 1 e 5).
 *
 * - Convite de um consumidor para `@_guidu_agent_<workspace>`: o núcleo
 *   recusa a sala do consumidor (ele seria o dono e poderia ligar E2EE) e
 *   abre uma sala do núcleo, convidando o consumidor e os atendentes.
 * - Mensagem do consumidor numa sala do núcleo com a conversa "pendente":
 *   o agente responde; "atendente" ou "humano" passa para "aberta".
 */

type MatrixEvent = Readonly<{
  type: string;
  room_id: string;
  sender: string;
  event_id: string;
  state_key?: string;
  content: Record<string, unknown>;
}>;

const AGENT_PREFIX = "@_guidu_agent_";

function log(message: string, data: Record<string, unknown> = {}): void {
  console.info(`[matrix-poc] ${message} ${JSON.stringify(data)}`);
}

/**
 * Eventos ainda não vistos. A chave é o `event_id`, não o `txnId`: com
 * SQLite o Synapse recomeça os `txnId` em 1 depois de reiniciar (o número
 * vem do maior txn pendente), e a prova perdeu eventos por isso. Na IN3,
 * chave única no banco (ADR 0011, regra 1).
 */
export function unseenEvents<T extends { event_id: string }>(
  config: MatrixPocConfig,
  events: readonly T[],
): T[] {
  const fresh: T[] = [];
  updateStore(config, (store) => {
    for (const event of events) {
      if (!store.transactions.includes(event.event_id)) {
        store.transactions.push(event.event_id);
        fresh.push(event);
      }
    }
  });
  return fresh;
}

export async function processTransaction(
  config: MatrixPocConfig,
  txnId: string,
  events: readonly MatrixEvent[],
): Promise<void> {
  for (const event of events) {
    log("evento", {
      txnId,
      type: event.type,
      sender: event.sender,
      room: event.room_id,
      ...(event.state_key !== undefined ? { state_key: event.state_key } : {}),
    });
    try {
      await handleEvent(config, event);
    } catch (error) {
      log("erro", { event: event.event_id, error: String(error) });
    }
  }
}

async function handleEvent(config: MatrixPocConfig, event: MatrixEvent): Promise<void> {
  if (event.sender.startsWith("@_guidu_")) return;

  if (
    event.type === "m.room.member" &&
    event.content.membership === "invite" &&
    event.state_key?.startsWith(AGENT_PREFIX)
  ) {
    await openConversation(config, event);
    return;
  }

  if (event.type === "m.room.message") {
    await answerContact(config, event);
  }
}

async function openConversation(config: MatrixPocConfig, event: MatrixEvent): Promise<void> {
  const agent = event.state_key!;
  const workspaceSlug = agent.slice(AGENT_PREFIX.length).split(":")[0]!;
  const store = readStore(config);
  // Recusa a sala que o consumidor criou: nela o dono é ele.
  await matrixFetch(config, "POST", `/_matrix/client/v3/rooms/${encodeURIComponent(event.room_id)}/leave`, {
    body: { reason: "O atendimento abre uma sala própria." },
    asUser: agent,
  }).catch(() => undefined);
  await ensureVirtualUser(config, agent.slice(1).split(":")[0]!, `Agente ${workspaceSlug}`);
  // A sala nasce sem o consumidor: o registro (a tabela da IN3) vem antes
  // do convite, senão a primeira mensagem chega a uma sala desconhecida.
  const roomId = await createConversationRoom(config, {
    name: `Conversa ${event.sender.split(":")[0]}`,
    agent,
    invite: [],
  });
  updateStore(config, (s) => {
    s.rooms[roomId] = {
      workspaceSlug,
      consumer: event.sender,
      createdAt: new Date().toISOString(),
    };
  });
  for (const attendant of store.attendants[workspaceSlug] ?? []) {
    await addAttendantToRoom(config, roomId, attendant);
  }
  await matrixFetch(config, "POST", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`, {
    body: { user_id: event.sender },
  });
  await sendText(
    config,
    roomId,
    agent,
    `Olá! Sou o agente de ${workspaceSlug}. Esta é a sua conversa com a equipe.`,
  );
  log("sala aberta pelo núcleo", { roomId, workspaceSlug, consumer: event.sender });
}

async function answerContact(config: MatrixPocConfig, event: MatrixEvent): Promise<void> {
  const store = readStore(config);
  const room = store.rooms[event.room_id];
  if (!room) return;
  // Mensagens da equipe não acionam o agente.
  if ((store.attendants[room.workspaceSlug] ?? []).includes(event.sender)) return;
  const state = await readConversationState(config, event.room_id);
  if (state && state.status !== "pending") {
    log("agente fora: conversa com a equipe", { room: event.room_id, status: state.status });
    return;
  }
  const agent = agentUserId(config, room.workspaceSlug);
  const text = typeof event.content.body === "string" ? event.content.body : "";
  await setTyping(config, event.room_id, agent, true);
  const answer = await answerAsPocAgent(`Agente ${room.workspaceSlug}`, text);
  await sendText(config, event.room_id, agent, answer.text);
  await setTyping(config, event.room_id, agent, false);
  log("agente respondeu", { room: event.room_id, handoff: answer.handoff });
  if (answer.handoff) {
    await writeConversationState(config, event.room_id, {
      version: 1,
      status: "open",
      assignee: null,
    });
    log("transferência: status aberta", { room: event.room_id });
  }
}
