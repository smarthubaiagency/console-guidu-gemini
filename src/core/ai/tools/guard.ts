import { createHash, randomUUID } from "node:crypto";

import { ModuleUnavailableError } from "@/core/modules/availability";
import { canonicalJson } from "@/core/proposals/operation";
import { PermissionDeniedError } from "@/core/permissions/guard";
import { AppError } from "@/shared/errors";

import { AGENT_TOOLS, type AgentKind, type AgentTool } from "../config/tools";

/**
 * Guard of the agent's tools (A2b, from the MCP Go evaluation approved on
 * 13/10/2026). Every call gets a policy decision before it runs, default
 * deny:
 *
 * - `allow`: in the catalog, available to the agent's kind and in the
 *   agent's allowlist (critério 5);
 * - `deny`: permanent (unknown tool, other kind, outside the allowlist);
 * - `restrict`: the tool exists for the agent but cannot run now (feature
 *   off, missing permission, nothing to act on).
 *
 * Each decision carries the rule and the reason and goes to the audit with
 * the turn's execution id and the SHA-256 of input and output; the payload
 * kept in the audit has personal data masked. A failure gives the model
 * only a safe message with an `error_id`, never the internal error.
 */

export type ToolDecision = Readonly<{
  decision: "allow" | "deny" | "restrict";
  rule: string;
  reason: string;
}>;

/** Tools in the catalog that wait for another stage. */
export const DISABLED_TOOLS: Readonly<Partial<Record<AgentTool, string>>> = {
  update_contact_property:
    "Campos personalizados do contato ainda não estão disponíveis (CRM-P).",
  add_tag: "Etiquetas do CRM ainda não estão disponíveis (D-AG-22).",
  search_knowledge: "Base de conhecimento ainda não está disponível (A7).",
};

export function decideTool(
  name: string,
  kind: AgentKind,
  allowlist: readonly string[],
): ToolDecision {
  if (!Object.hasOwn(AGENT_TOOLS, name)) {
    return {
      decision: "deny",
      rule: "unknown_tool",
      reason: "Ferramenta fora do catálogo.",
    };
  }
  const tool = name as AgentTool;
  if (!(AGENT_TOOLS[tool] as readonly AgentKind[]).includes(kind)) {
    return {
      decision: "deny",
      rule: "kind_not_allowed",
      reason: "Ferramenta de outro tipo de agente.",
    };
  }
  if (!allowlist.includes(tool)) {
    return {
      decision: "deny",
      rule: "not_in_allowlist",
      reason: "Ferramenta fora da lista do agente.",
    };
  }
  const disabled = DISABLED_TOOLS[tool];
  if (disabled) {
    return { decision: "restrict", rule: "feature_disabled", reason: disabled };
  }
  return {
    decision: "allow",
    rule: "allowlist",
    reason: "Na lista do agente.",
  };
}

/** A tool that cannot act now; the reason is safe for the model. */
export class ToolRestrictedError extends Error {
  constructor(
    readonly rule: string,
    readonly reason: string,
  ) {
    super(reason);
    this.name = "ToolRestrictedError";
  }
}

export function sha256(value: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(value ?? null))
    .digest("hex");
}

const IDENTIFIER = /^[a-z0-9_.:-]{1,60}$/;
const EMAIL = /^([^\s@])[^\s@]*@([^\s@]+\.[^\s@]+)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function maskString(value: string): string {
  const email = value.match(EMAIL);
  if (email) return `${email[1]}***@${email[2]}`;
  if (UUID.test(value) || IDENTIFIER.test(value)) return value;
  if ((value.match(/\d/g) ?? []).length >= 6) {
    // Phone and document numbers: only the last two digits stay.
    let digits = (value.match(/\d/g) ?? []).length;
    return value.replace(/\d/g, (d) => (--digits < 2 ? d : "*"));
  }
  return `${value.slice(0, 1)}*** (${value.length})`;
}

/** The payload with personal data masked, for the audit. */
export function maskPersonalData(value: unknown, depth = 0): unknown {
  if (depth > 6) return "…";
  if (typeof value === "string") return maskString(value);
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((v) => maskPersonalData(v, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 30)
        .map(([k, v]) => [k, maskPersonalData(v, depth + 1)]),
    );
  }
  return value;
}

/** One tool call as the audit keeps it. */
export type ToolCallRecord = Readonly<{
  tool: string;
  toolCallId: string;
  decision: ToolDecision["decision"] | "error";
  rule: string;
  reason: string;
  inputHash: string;
  outputHash: string | null;
  /** Masked input, as JSON, at most 2000 characters. */
  payload: string;
  errorId: string | null;
}>;

export function callRecord(
  tool: string,
  toolCallId: string,
  input: unknown,
  decision: ToolDecision | { decision: "error"; rule: string; reason: string },
  output: unknown,
  errorId: string | null = null,
): ToolCallRecord {
  return {
    tool,
    toolCallId,
    decision: decision.decision,
    rule: decision.rule,
    reason: decision.reason,
    inputHash: sha256(input),
    outputHash: output === undefined ? null : sha256(output),
    payload: JSON.stringify(maskPersonalData(input)).slice(0, 2000),
    errorId,
  };
}

/** What a tool returns to the model. */
export type ToolOutput =
  | Readonly<{ ok: true; result: unknown }>
  | Readonly<{ ok: false; error: string; errorId?: string }>;

export type GuardedRun = Readonly<{
  output: ToolOutput;
  record: ToolCallRecord;
}>;

/**
 * Runs one tool call under the guard. `run` holds the effect; whatever it
 * throws becomes a restriction (permission, feature, nothing to act on), a
 * safe message of the domain (AppError) or a generic failure with an
 * `error_id` written to the server log.
 */
export async function guardToolCall(
  args: Readonly<{
    tool: string;
    toolCallId: string;
    input: unknown;
    kind: AgentKind;
    allowlist: readonly string[];
    run: () => Promise<unknown>;
    messages: Readonly<{
      denied: string;
      restricted: (reason: string) => string;
      failed: (errorId: string) => string;
    }>;
    onError?: (errorId: string, error: unknown) => void;
  }>,
): Promise<GuardedRun> {
  const { tool, toolCallId, input } = args;
  const decision = decideTool(tool, args.kind, args.allowlist);
  if (decision.decision !== "allow") {
    const output: ToolOutput = {
      ok: false,
      error:
        decision.decision === "deny"
          ? args.messages.denied
          : args.messages.restricted(decision.reason),
    };
    return {
      output,
      record: callRecord(tool, toolCallId, input, decision, output),
    };
  }
  try {
    const result = await args.run();
    const output: ToolOutput = { ok: true, result };
    return {
      output,
      record: callRecord(tool, toolCallId, input, decision, output),
    };
  } catch (error) {
    if (error instanceof ToolRestrictedError) {
      const output: ToolOutput = {
        ok: false,
        error: args.messages.restricted(error.reason),
      };
      const restricted = {
        decision: "restrict" as const,
        rule: error.rule,
        reason: error.reason,
      };
      return {
        output,
        record: callRecord(tool, toolCallId, input, restricted, output),
      };
    }
    if (
      error instanceof PermissionDeniedError ||
      error instanceof ModuleUnavailableError ||
      (error instanceof AppError && error.code === "forbidden")
    ) {
      const reason =
        error instanceof AppError
          ? error.safeMessage
          : error instanceof ModuleUnavailableError
            ? "O módulo desta ação não está disponível neste workspace."
            : "Quem conversa não tem permissão para esta ação.";
      const output: ToolOutput = {
        ok: false,
        error: args.messages.restricted(reason),
      };
      return {
        output,
        record: callRecord(
          tool,
          toolCallId,
          input,
          { decision: "restrict", rule: "permission", reason },
          output,
        ),
      };
    }
    if (error instanceof AppError && error.code !== "internal") {
      // The domain's own message is written for people: safe to show.
      const output: ToolOutput = { ok: false, error: error.safeMessage };
      return {
        output,
        record: callRecord(
          tool,
          toolCallId,
          input,
          { decision: "allow", rule: "allowlist", reason: error.code },
          output,
        ),
      };
    }
    const errorId = randomUUID();
    args.onError?.(errorId, error);
    const output: ToolOutput = {
      ok: false,
      error: args.messages.failed(errorId),
      errorId,
    };
    return {
      output,
      record: callRecord(
        tool,
        toolCallId,
        input,
        { decision: "error", rule: "tool_failed", reason: "Falha interna." },
        output,
        errorId,
      ),
    };
  }
}
