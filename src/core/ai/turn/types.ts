import type { ContextTransaction } from "@/lib/prisma/with-context";

import type { ToolCallRecord } from "../tools/guard";

/**
 * Short transactions of a turn, each with the context of who talks (A2b).
 * The model call happens between them, never inside one.
 */
export type TurnDb = Readonly<{
  transaction<T>(operation: (tx: ContextTransaction) => Promise<T>): Promise<T>;
}>;

/** Limits of every turn (especificação §8): steps, output and time. */
export const TURN_LIMITS = {
  /** Model calls in a turn, counting the tool rounds and the answer. */
  maxSteps: 6,
  maxOutputTokens: 2000,
  totalMs: 90_000,
  /** Messages of the conversation sent back to the model. */
  historyMessages: 30,
  /** Longest message of a person. */
  maxUserMessage: 4000,
} as const;

/** Conversation memory per conversation (variaveis.md §2.5). */
export const MAX_CONVERSATION_VARIABLES = 30;

/** What the tools change during a turn. */
export type TurnState = {
  contactId: string | null;
  status: "active" | "handoff" | "closed";
  memory: Record<string, unknown>;
  records: ToolCallRecord[];
  /** What the agent told the team when it handed over (A5c). */
  handoff?: Readonly<{ reason: string; summary: string }>;
};
