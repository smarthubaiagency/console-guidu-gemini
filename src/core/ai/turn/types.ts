import type { ContextTransaction } from "@/lib/prisma/with-context";

import type { DelegateTarget, Specialists } from "../delegation";
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
  /**
   * Time of a whole turn that hands the conversation to a specialist (GF2):
   * the orchestrator and the specialist together, under the job's expiry.
   */
  delegationTotalMs: 150_000,
  /** Messages of the conversation sent back to the model. */
  historyMessages: 30,
  /** Longest message of a person. */
  maxUserMessage: 4000,
} as const;

/** Conversation memory per conversation (variaveis.md §2.5). */
export const MAX_CONVERSATION_VARIABLES = 30;

/** A Portfolio file the agent sends with its answer (A5d). */
export type OutboundMedia = Readonly<{
  kind: "image" | "document";
  /** Public https address of the file, from the Portfolio. */
  url: string;
  /** The item's title, or the file's own. */
  caption: string | null;
}>;

/** Portfolio files of one answer. */
export const MAX_OUTBOX = 3;

/** What the tools change during a turn. */
export type TurnState = {
  contactId: string | null;
  status: "active" | "handoff" | "closed";
  memory: Record<string, unknown>;
  records: ToolCallRecord[];
  /** What the agent told the team when it handed over (A5c). */
  handoff?: Readonly<{ reason: string; summary: string }>;
  /** Portfolio files to send after the answer, in order (A5d). */
  outbox?: OutboundMedia[];
  /** The orchestrator asked to hand the conversation over (GF2). */
  delegation?: Readonly<{
    to: DelegateTarget;
    agentId: string;
    reason: string;
    summary: string;
  }>;
  /** Invalid calls of `delegate` in this turn (GF2). */
  invalidDelegations?: number;
  /** The specialist gave the conversation back to the reception (GF2). */
  returned?: Readonly<{ reason: string }>;
  /**
   * Set when a specialist wrote this turn's answer: its role, for the
   * "Respondido pelo …" mark the team sees (GF2).
   */
  answeredBy?: DelegateTarget;
};

/** What a turn knows of the delegation (GF2), by the role of its GUIDS. */
export type TurnDelegation = Readonly<{
  /** Orchestrator: the specialists that are on. */
  specialists: Specialists;
  /** Specialist: the orchestrator the conversation goes back to. */
  returnTo: string | null;
}>;
