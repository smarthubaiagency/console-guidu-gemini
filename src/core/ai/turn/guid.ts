import "server-only";

import {
  APICallError,
  generateText,
  isStepCount,
  NoSuchToolError,
  Output,
  type ModelMessage,
} from "ai";
import { z } from "zod";

import { decryptSecret } from "@/core/credentials/crypto";
import type { AIProvider } from "@/core/credentials/vault";
import { resolveQuota } from "@/core/entitlements/quotas";
import { defineDetachedJob, type JobSession } from "@/core/jobs/definition";
import { SkipJobError } from "@/core/jobs/errors";
import type { ContactLocale } from "@/core/matrix/locale";
import { assertModuleOperational } from "@/core/module-runtime/state";
import { ModuleUnavailableError } from "@/core/modules/availability";
import { Permissions } from "@/core/permissions/catalog";
import {
  getEffectiveWorkspaceRole,
  requireWorkspacePermission,
} from "@/core/permissions/guard";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";
import { appLog } from "@/lib/telemetry/log";
import { AppError } from "@/shared/errors";

import {
  backupServes,
  isKeyFailure,
  loadBackupKey,
  startKeyBackup,
} from "../backup";
import { withBaseUrl } from "../catalog";
import { type AgentConfig, parseAgentConfig } from "../config/schema";
import {
  DELEGATE_TARGETS,
  type DelegateTarget,
  delegationActive,
  delegationUntil,
  handoverData,
  isOn,
  mayDelegate,
  MIN_SPECIALIST_MS,
  pickSpecialists,
  remainingMs,
  type Specialists,
} from "../delegation";
import {
  type ChatModelKey,
  createChatModel,
  type ModelFactory,
  type SpeechFactory,
  type TranscriptionFactory,
} from "../providers";
import { renderSystemPrompt } from "../prompt/render";
import { format, promptLocale, promptTexts } from "../prompt/texts";
import {
  buildTools,
  offeredTools,
  recordRefusedCall,
  type ToolEnv,
} from "../tools/catalog";
import { contactLocaleInstruction } from "./contact-locale";
import { contextValues, turnTimeZone } from "./context";
import { withRegionTimeZone } from "./region";
import {
  afterHoursReply,
  businessHours,
  hoursInstruction,
  localStamp,
} from "./hours";
import {
  mediaTexts,
  type PreparedMedia,
  prepareMedia,
  type TurnAttachment,
} from "./media";
import {
  persistAutoReply,
  persistDelegation,
  persistDelegationEnd,
  persistKeyFailure,
  persistTurn,
  persistTurnError,
  type UsageOwner,
} from "./persist";
import { MAX_REFERRALS_IN_PROMPT, referralsInstruction } from "./referrals";
import { ResponsePlan, turnErrorCode } from "./plan";
import {
  speakAnswer,
  type SpokenAnswer,
  type VoiceKey,
  voiceKeyOf,
} from "./speech";
import {
  TURN_LIMITS,
  type TurnDelegation,
  type TurnState,
} from "./types";

/**
 * Turn of a GUIDS (A2b), a detached job of the worker: it answers one
 * message of a conversation with the customer's key, as the person who
 * sent it (the test of the agent until the channels of the A5).
 *
 * 1. A short transaction loads the conversation, the agent and the key and
 *    checks that the turn may run (module, permission, paused agent, plan
 *    limit, prompt, model and key).
 * 2. The model runs outside any transaction; each tool opens its own.
 * 3. A short transaction writes the answer, the usage and the audit.
 *
 * When the customer's key fails, the turn goes on with the platform key
 * (A2c, `../backup.ts`), only in a conversation opened before the failure.
 *
 * A test conversation ("Testar agente", A4b, §5.3) runs the same turn with
 * the tools simulated, also while the agent is paused or still a draft, and
 * counts in the usage. When it answers with the customer's key, the agent
 * records that its current configuration passed the test, the condition to
 * turn it on.
 *
 * The answer is a response plan (canais.md §6.1) validated by Zod before
 * it is written. The job's run id is the turn's execution id: a turn that
 * already wrote its answer is not answered again.
 */

export const GUID_TURN_JOB_KIND = "ai-agents.guid-turn";

export const GuidTurnPayload = z.strictObject({
  conversationId: z.uuid(),
  messageId: z.uuid(),
});
export type GuidTurnPayload = z.infer<typeof GuidTurnPayload>;

export type GuidTurnDeps = Readonly<{
  createModel?: ModelFactory;
  now?: () => Date;
  /** Shape of the answer on a channel (A5b, the integration's settings). */
  answerLimits?: Readonly<{ maxMessages: number; maxChars: number }>;
  /** The contact's language, known by the room (TR1); null: unknown. */
  contactLocale?: ContactLocale | null;
  /** Files the contact sent with the message (A5c, channels). */
  media?: readonly TurnAttachment[];
  createTranscription?: TranscriptionFactory;
  /** Speak the answer (A5d): the contact sent audio on a channel. */
  speak?: boolean;
  createSpeech?: SpeechFactory;
  convertAudio?: (wav: Uint8Array) => Promise<Uint8Array | null>;
}>;

/** The answer's shape, told to the model in the agent's language. */
function limitsInstruction(
  locale: string,
  limits: Readonly<{ maxMessages: number; maxChars: number }>,
): string {
  const { maxMessages: m, maxChars: c } = limits;
  switch (locale) {
    case "en":
      return `Answer in at most ${m} short messages, each up to ${c} characters.`;
    case "es":
      return `Responde en como máximo ${m} mensajes cortos, cada uno de hasta ${c} caracteres.`;
    default:
      return `Responda em no máximo ${m} mensagens curtas, cada uma com até ${c} caracteres.`;
  }
}

const MODULE_KEY = "ai-agents";

type Blocked = Readonly<{
  kind: "blocked";
  code: string;
  message: string;
  conversationId: string;
  agentId: string;
  /** A specialist that held the conversation could not run (GF2). */
  held?: boolean;
}>;

type TurnKey = ChatModelKey & Readonly<{ source: "customer" | "backup" }>;

type Ready = Readonly<{
  kind: "ready";
  /** A test of the agent: simulated tools, the pass recorded. */
  test: boolean;
  /** `md5(config::text)` of the configuration this turn answers with. */
  configHash: string | null;
  conversationId: string;
  agentId: string;
  conversationCreatedAt: Date;
  config: AgentConfig;
  key: TurnKey;
  /** The key that hears and speaks (A5d); null: none. */
  voice: VoiceKey | null;
  systemPrompt: string;
  /** The local time and the business hours, after the prompt (A6c). */
  hoursNote: string;
  /** The business's referrals, when the agent may refer (A6b). */
  referralsNote: string | null;
  history: ModelMessage[];
  state: TurnState;
  /** Role of a factory GUIDS (GF1), null for any other. */
  factoryRole: string | null;
  /**
   * GF2. Orchestrator: the specialists that are on. Specialist: the
   * orchestrator the conversation goes back to (`returnTo`), also when it
   * holds the conversation from an earlier message.
   */
  delegation: TurnDelegation;
  /** The role of the specialist that holds this turn, or null. */
  specialistRole: DelegateTarget | null;
  /** What the orchestrator passed on in this turn, for the specialist. */
  handover: Readonly<{ reason: string; summary: string }> | null;
}>;

/**
 * After hours with "auto reply only" (A6c): the fixed answer, once per
 * closed period; null when this period was already answered.
 */
type AfterHours = Readonly<{
  kind: "after_hours";
  reply: string | null;
  conversationId: string;
  agentId: string;
  /** A specialist holds the conversation (GF2). */
  viaDelegation: boolean;
}>;

/** The orchestrator's hand-over, run in the same turn (GF2). */
type Handover = Readonly<{ agentId: string; reason: string; summary: string }>;

function blocked(
  code: string,
  message: string,
  ids: Readonly<{ conversationId: string; agentId: string }>,
): Blocked {
  return { kind: "blocked", code, message, ...ids };
}

/**
 * A specialist that runs right after the orchestrator answers the contact's
 * message: what the orchestrator wrote beside its `delegate` call is not
 * for the contact, so the history ends with the contact's message (a model
 * must not be asked to continue its own last message).
 */
function trimToContact(history: ModelMessage[], handedOver: boolean) {
  if (!handedOver) return history;
  const out = [...history];
  while (out.length > 0 && out.at(-1)?.role === "assistant") out.pop();
  return out;
}

async function loadTurn(
  tx: ContextTransaction,
  ctx: RequestContext,
  payload: GuidTurnPayload,
  executionId: string,
  now: Date,
  handover: Handover | null,
): Promise<Ready | Blocked | AfterHours | { kind: "done" }> {
  // RLS shows the conversation only to who may read it.
  const conversation = await tx.aiConversation.findFirst({
    where: {
      id: payload.conversationId,
      kind: "guid",
      workspaceId: ctx.workspaceId,
    },
  });
  if (!conversation) throw new SkipJobError("Conversa não encontrada.");
  // The specialist of a hand-over runs after the orchestrator wrote its
  // own rows with the same execution id (GF2).
  const answered = handover
    ? 0
    : await tx.aiMessage.count({
        where: { conversationId: conversation.id, executionId },
      });
  if (answered > 0) return { kind: "done" };
  const message = await tx.aiMessage.findFirst({
    where: {
      id: payload.messageId,
      conversationId: conversation.id,
      role: "user",
    },
    select: { id: true },
  });
  if (!message) throw new SkipJobError("Mensagem não encontrada.");

  const ids = {
    conversationId: conversation.id,
    agentId: conversation.agentId,
  };
  try {
    await assertModuleOperational(tx, ctx, MODULE_KEY, "write");
  } catch (error) {
    if (!(error instanceof ModuleUnavailableError)) throw error;
    return blocked(
      "module_unavailable",
      "O módulo de agentes não está disponível neste workspace.",
      ids,
    );
  }
  await requireWorkspacePermission(tx, ctx, Permissions.AI_AGENTS_USE);
  if (conversation.status !== "active") {
    return blocked(
      `conversation_${conversation.status}`,
      "A conversa não está mais com o agente.",
      ids,
    );
  }

  const agentOf = (id: string) =>
    tx.aiAgent.findFirst({
      where: { id, kind: "guid", workspaceId: ctx.workspaceId },
    });
  // GF2: who holds the conversation now. A specialist the orchestrator
  // handed it to keeps it until it returns it, the conversation is resolved
  // or the contact is silent for 24 h (`delegated_until`, pushed forward at
  // each message); one that is no longer on gives it back.
  let agent: Awaited<ReturnType<typeof agentOf>> = null;
  let returnTo: string | null = null;
  const heldBy = handover
    ? handover.agentId
    : delegationActive(conversation, now)
      ? conversation.delegatedAgentId
      : null;
  if (heldBy && heldBy !== conversation.agentId) {
    const candidate = await agentOf(heldBy);
    if (candidate && isOn(candidate)) {
      agent = candidate;
      returnTo = conversation.agentId;
    } else if (handover) {
      return blocked(
        "specialist_unavailable",
        "O especialista não está disponível.",
        ids,
      );
    }
  }
  if (!agent && conversation.delegatedAgentId && !handover) {
    // Expired, or the specialist went off: back to the orchestrator.
    await tx.aiConversation.updateMany({
      where: { id: conversation.id },
      data: { delegatedAgentId: null, delegatedUntil: null },
    });
  }
  agent ??= await agentOf(conversation.agentId);
  if (!agent) throw new SkipJobError("Agente não encontrado.");
  const agentIds = { conversationId: conversation.id, agentId: agent.id };
  // A specialist that holds the conversation but cannot run (no key, no
  // model, no prompt...) gives it back; the turn then runs as the
  // orchestrator (GF2). The deadline is pushed forward only after the
  // specialist answered.
  const held = returnTo !== null && !handover;
  const blockedHere = (code: string, message: string): Blocked => ({
    ...blocked(code, message, agentIds),
    held,
  });
  const test = conversation.channel === "test";
  // A paused agent is tested before it is turned on again.
  if (agent.status === "paused" && !test) {
    return blockedHere("agent_paused", "O agente está pausado.");
  }
  if (agent.keyState === "failed") {
    return blockedHere("key_failed", "A chave do agente falhou.");
  }
  if (
    agent.keyState === "backup" &&
    (!agent.backupStartedAt ||
      !backupServes(conversation.createdAt, agent.backupStartedAt, now))
  ) {
    // The backup only finishes conversations already open (§9.2).
    return blockedHere("key_failed", "A chave do agente falhou; o backup só termina conversas já abertas.");
  }
  const [count, quota] = await Promise.all([
    tx.aiAgent.count({ where: { workspaceId: ctx.workspaceId, kind: "guid" } }),
    resolveQuota(tx, ctx.organizationId, "ai-agents.max"),
  ]);
  if (quota.limit !== null && count > quota.limit) {
    return blockedHere("plan_limit", "O workspace tem mais agentes do que o plano permite.");
  }
  const parsed = parseAgentConfig("guid", agent.configVersion, agent.config);
  if (!parsed.success) {
    return blockedHere("invalid_config", "A configuração do agente é inválida.");
  }
  const config = await withRegionTimeZone(tx, parsed.data);
  const timeZone = turnTimeZone(config);
  const hours = businessHours(config.scope.availability_slots, now, timeZone);
  // A test answers with the model at any hour, so it can pass at night.
  if (
    !test &&
    !handover &&
    !hours.open &&
    config.rules.after_hours_behavior === "auto_reply_only"
  ) {
    const last = await tx.aiMessage.findFirst({
      where: {
        conversationId: conversation.id,
        role: "assistant",
        errorCode: null,
        content: { not: "" },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { createdAt: true },
    });
    const answered =
      last !== null &&
      hours.closedSince !== null &&
      localStamp(last.createdAt, timeZone) >= hours.closedSince;
    return {
      kind: "after_hours",
      reply: answered
        ? null
        : afterHoursReply(
            config,
            promptTexts(promptLocale(config.overview.language)),
          ),
      ...agentIds,
      viaDelegation: returnTo !== null,
    };
  }
  let key: TurnKey;
  if (agent.keyState === "backup") {
    const backup = await loadBackupKey(tx, agent.id);
    if (!backup) {
      return blockedHere("key_failed", "A chave do agente falhou e não há chave de backup.");
    }
    key = { ...backup, source: "backup" };
  } else {
    const credentialId = config.model.credential_id;
    const modelName = config.model.model_name;
    if (!credentialId || !modelName) {
      return blockedHere("no_model", "O agente não tem chave e modelo escolhidos.");
    }
    const credential = await tx.credential.findFirst({
      where: {
        id: credentialId,
        workspaceId: ctx.workspaceId,
        status: "active",
        purpose: { in: ["chat", "all"] },
      },
      select: { provider: true, encryptedPayload: true },
    });
    if (!credential) {
      return blockedHere("no_key", "A chave do agente não está ativa.");
    }
    key = {
      provider: credential.provider as AIProvider,
      secret: decryptSecret(credential.encryptedPayload),
      model: modelName,
      source: "customer",
    };
  }
  // The platform's gateway of the key's provider, when one is set (CF6a).
  key = await withBaseUrl(tx, key);
  // The voice key, or the text key when it has a voice; never the backup.
  let voice: VoiceKey | null = null;
  if (key.source === "customer") {
    const voiceId = config.model.audio_credential_id;
    if (voiceId) {
      const credential = await tx.credential.findFirst({
        where: {
          id: voiceId,
          workspaceId: ctx.workspaceId,
          status: "active",
          purpose: { in: ["chat", "all"] },
        },
        select: { provider: true, encryptedPayload: true },
      });
      voice = credential
        ? voiceKeyOf(
            {
              provider: credential.provider as AIProvider,
              secret: decryptSecret(credential.encryptedPayload),
            },
            config.model,
          )
        : null;
    } else {
      voice = voiceKeyOf(key, config.model);
    }
  }

  const [contact, organization, workspace, role, messagesCount, recent] =
    await Promise.all([
      conversation.contactId
        ? tx.crmContact.findFirst({
            where: { id: conversation.contactId, workspaceId: ctx.workspaceId },
          })
        : null,
      tx.organization.findFirst({
        where: { id: ctx.organizationId },
        select: { name: true },
      }),
      tx.workspace.findFirst({
        where: { id: ctx.workspaceId },
        select: { name: true, defaultLocale: true },
      }),
      getEffectiveWorkspaceRole(tx, ctx),
      tx.aiMessage.count({ where: { conversationId: conversation.id } }),
      tx.aiMessage.findMany({
        where: {
          conversationId: conversation.id,
          role: { in: ["user", "assistant"] },
          errorCode: null,
          content: { not: "" },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: TURN_LIMITS.historyMessages,
        select: { role: true, content: true },
      }),
    ]);

  const memory = (conversation.variables ?? {}) as Record<string, unknown>;
  const locale = promptLocale(config.overview.language);
  const systemPrompt = renderSystemPrompt({
    kind: "guid",
    config,
    locale,
    memory,
    context: contextValues({
      kind: "guid",
      agentId: agent.id,
      config,
      now,
      dateLocale: config.overview.language ?? "pt-BR",
      company: {
        name: organization?.name ?? workspace?.name ?? null,
        locale: workspace?.defaultLocale ?? null,
      },
      user: { name: null, role },
      contact: contact
        ? {
            id: contact.id,
            name: contact.name,
            email: contact.email,
            phone: contact.phone,
            companyName: contact.companyName,
            jobTitle: contact.jobTitle,
          }
        : null,
      conversation: {
        id: conversation.id,
        channel: conversation.channel,
        startedAt: conversation.createdAt,
        lastMessageAt: conversation.lastMessageAt,
        messagesCount,
      },
    }),
  });
  if (!systemPrompt) {
    return blockedHere("no_prompt", "O agente não tem prompt.");
  }
  const referrals = offeredTools("guid", config).includes("refer_contact")
    ? await tx.aiAgentReferral.findMany({
        where: { workspaceId: ctx.workspaceId },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: MAX_REFERRALS_IN_PROMPT,
        select: {
          name: true,
          referralTag: true,
          specialties: true,
          city: true,
          remote: true,
        },
      })
    : [];
  // GF2: the orchestrator offers the specialists that are on.
  const factoryRole = agent.factoryRole ?? null;
  let specialists: Specialists = {};
  if (mayDelegate(factoryRole)) {
    const rows = await tx.aiAgent.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        kind: "guid",
        factoryRole: { in: [...DELEGATE_TARGETS] },
      },
      select: {
        id: true,
        factoryRole: true,
        status: true,
        keyState: true,
        config: true,
      },
    });
    specialists = pickSpecialists(
      rows.map((row) => ({
        id: row.id,
        factoryRole: row.factoryRole,
        status: row.status,
        keyState: row.keyState,
        name:
          (row.config as { overview?: { agent_name?: string } } | null)
            ?.overview?.agent_name ?? null,
      })),
    );
  }
  const specialistRole =
    returnTo !== null &&
    (factoryRole === "attendant" || factoryRole === "seller")
      ? factoryRole
      : null;
  const hash = test
    ? await tx.$queryRaw<{ hash: string }[]>`
        select md5(config::text) as hash from public.ai_agents
        where id = ${agent.id}::uuid
      `
    : [];

  return {
    kind: "ready",
    test,
    configHash: hash[0]?.hash ?? null,
    ...agentIds,
    conversationCreatedAt: conversation.createdAt,
    config,
    key,
    voice,
    systemPrompt,
    hoursNote: hoursInstruction(
      config,
      hours,
      now,
      timeZone,
      config.overview.language ?? "pt-BR",
      promptTexts(locale),
    ),
    referralsNote: referralsInstruction(referrals, promptTexts(locale)),
    history: trimToContact(
      recent
        .reverse()
        .map((m): ModelMessage =>
          m.role === "user"
            ? { role: "user", content: m.content }
            : { role: "assistant", content: m.content },
        ),
      handover !== null,
    ),
    state: {
      contactId: conversation.contactId,
      status: conversation.status as TurnState["status"],
      memory: { ...memory },
      records: [],
      ...(specialistRole ? { answeredBy: specialistRole } : {}),
    },
    factoryRole,
    delegation: { specialists, returnTo },
    specialistRole,
    handover: handover
      ? { reason: handover.reason, summary: handover.summary }
      : null,
  };
}

export async function runGuidTurn(
  session: JobSession,
  ctx: RequestContext,
  payload: GuidTurnPayload,
  deps: GuidTurnDeps = {},
): Promise<Record<string, string | number>> {
  return (await runGuidTurnWithState(session, ctx, payload, deps)).result;
}

type Finished = Readonly<{
  result: Record<string, string | number>;
  state: TurnState | null;
  /** The answer as a voice message, when asked and spoken (A5d). */
  spoken?: SpokenAnswer | null;
}>;

type Audit = Readonly<{ ctx: RequestContext; origin: "worker" }>;

/** What the parts of one turn share (GF2: the orchestrator and the specialist). */
type TurnRun = Readonly<{
  executionId: string;
  now: () => Date;
  audit: Audit;
  /** When the turn started: the time budget is of the whole turn. */
  startedAt: number;
}>;

type Run =
  | Readonly<{ kind: "finished"; value: Finished }>
  | Readonly<{
      kind: "delegated";
      delegation: NonNullable<TurnState["delegation"]>;
      state: TurnState;
      /** The orchestrator's own test passed in this turn (a test only). */
      tested: boolean;
    }>;

/**
 * A delegation that did not reach an answer goes to the team (GF2, budget of
 * the turn): the conversation is handed over with the reason in a code, the
 * delegation ends and the audit says so. The callers read the handoff from
 * the state, as for the `handoff` tool.
 */
async function handToTeam(
  session: JobSession,
  args: Readonly<{
    audit: Audit;
    conversationId: string;
    executionId: string;
    /** The orchestrator that handed the conversation over. */
    agentId: string;
    role: DelegateTarget;
    language: string | undefined;
    code: string;
    summary: string;
    state: TurnState;
  }>,
): Promise<Finished> {
  const texts = promptTexts(promptLocale(args.language)).delegation;
  const role = texts.roles[args.role] ?? args.role;
  await session.transaction((tx) =>
    persistDelegationEnd(
      tx,
      {
        conversationId: args.conversationId,
        agentId: args.agentId,
        executionId: args.executionId,
        audit: args.audit,
      },
      { action: "ai_agents.guid.delegate", role: args.role, code: args.code },
    ),
  );
  args.state.status = "handoff";
  args.state.handoff = {
    reason: format(texts.failedReason, {
      role,
      cause: texts.causes[args.code] ?? args.code,
    }).slice(0, 500),
    summary: format(texts.failedSummary, {
      role,
      summary: args.summary,
    }).slice(0, 1500),
  };
  appLog.warn("ai.turn.delegation_failed", {
    executionId: args.executionId,
    code: args.code,
    role: args.role,
  });
  return {
    result: {
      status: "handoff",
      delegated: 1,
      reason: args.code,
      messages: 0,
      tools: args.state.records.length,
    },
    state: args.state,
  };
}

/** The turn, with what its tools changed (the channels read the handoff). */
export async function runGuidTurnWithState(
  session: JobSession,
  ctx: RequestContext,
  payload: GuidTurnPayload,
  deps: GuidTurnDeps = {},
): Promise<Finished> {
  const executionId = session.jobRunId;
  const now = deps.now ?? (() => new Date());
  const audit: Audit = { ctx, origin: "worker" };
  const run: TurnRun = { executionId, now, audit, startedAt: Date.now() };
  let loaded = await session.transaction((tx) =>
    loadTurn(tx, ctx, payload, executionId, now(), null),
  );
  if (loaded.kind === "blocked" && loaded.held) {
    // The specialist that held the conversation cannot answer: the
    // conversation goes back to the orchestrator, which answers now.
    const stuck = loaded;
    appLog.warn("ai.turn.specialist_released", {
      executionId,
      code: stuck.code,
    });
    await session.transaction((tx) =>
      tx.aiConversation.updateMany({
        where: { id: stuck.conversationId },
        data: { delegatedAgentId: null, delegatedUntil: null },
      }),
    );
    loaded = await session.transaction((tx) =>
      loadTurn(tx, ctx, payload, executionId, now(), null),
    );
  }
  if (loaded.kind === "done") {
    return { result: { status: "already_answered" }, state: null };
  }
  if (loaded.kind === "after_hours") {
    const { reply } = loaded;
    if (reply === null) {
      return { result: { status: "after_hours_silent" }, state: null };
    }
    await session.transaction((tx) =>
      persistAutoReply(tx, {
        conversationId: loaded.conversationId,
        agentId: loaded.agentId,
        executionId,
        content: reply,
        at: now(),
        viaDelegation: loaded.viaDelegation,
        audit,
      }),
    );
    return {
      result: { status: "after_hours_reply", messages: 1 },
      state: null,
    };
  }
  if (loaded.kind === "blocked") {
    await session.transaction((tx) =>
      persistTurnError(tx, {
        conversationId: loaded.conversationId,
        agentId: loaded.agentId,
        executionId,
        errorCode: loaded.code,
        audit,
      }),
    );
    throw new SkipJobError(loaded.message);
  }

  const first = await runLoaded(session, ctx, payload, loaded, deps, run);
  if (first.kind === "finished") return first.value;

  // GF2: the orchestrator handed the conversation over and its own turn is
  // written. The specialist answers now, with its own configuration, on the
  // same conversation, if the budget of the turn still allows it; anything
  // that does not reach an answer goes to the team.
  const { delegation, state } = first;
  const toTeam = (code: string, onState: TurnState) =>
    handToTeam(session, {
      audit,
      conversationId: loaded.conversationId,
      executionId,
      agentId: loaded.agentId,
      role: delegation.to,
      language: loaded.config.overview.language,
      code,
      summary: delegation.summary,
      state: onState,
    });
  if (
    remainingMs(run.startedAt, TURN_LIMITS.delegationTotalMs, Date.now()) <
    MIN_SPECIALIST_MS
  ) {
    return toTeam("timeout", state);
  }
  const specialist = await session.transaction((tx) =>
    loadTurn(tx, ctx, payload, executionId, now(), {
      agentId: delegation.agentId,
      reason: delegation.reason,
      summary: delegation.summary,
    }),
  );
  if (specialist.kind !== "ready") return toTeam("unavailable", state);
  // The files were read by the orchestrator: their notes and transcripts
  // are in the history the specialist reads.
  const { media: read, ...specialistDeps } = deps;
  void read;
  const second = await runLoaded(
    session,
    ctx,
    payload,
    specialist,
    specialistDeps,
    run,
  );
  if (second.kind === "delegated") return toTeam("unavailable", second.state);
  return {
    ...second.value,
    result: {
      ...second.value.result,
      delegated: 1,
      // A test of the orchestrator: its own pass is the one that counts.
      ...(loaded.test ? { tested: first.tested ? 1 : 0 } : {}),
    },
  };
}

/**
 * One GUIDS answering: the model run (outside any transaction), its tools,
 * the usage and the audit. Also the specialist's run after a hand-over
 * (GF2), whose failure to answer (invalid output after a new try, or the
 * budget of the turn) goes to the team.
 */
async function runLoaded(
  session: JobSession,
  ctx: RequestContext,
  payload: GuidTurnPayload,
  loaded: Ready,
  deps: GuidTurnDeps,
  run: TurnRun,
): Promise<Run> {
  const { executionId, now, audit } = run;
  const { config, state } = loaded;
  const specialist = loaded.delegation.returnTo !== null;
  const env: ToolEnv = {
    kind: "guid",
    executionId,
    agentId: loaded.agentId,
    conversationId: loaded.conversationId,
    config,
    locale: promptLocale(config.overview.language),
    db: session,
    workspace: ctx,
    prisma: null,
    now,
    state,
    simulate: loaded.test,
    factoryRole: loaded.factoryRole,
    delegation: loaded.delegation,
  };
  const turn = {
    conversationId: loaded.conversationId,
    agentId: loaded.agentId,
    executionId,
    viaDelegation: specialist,
    audit,
  };

  // Files of the message (A5c): their notes and transcripts are kept as a
  // message of the contact right after it (messages are never rewritten);
  // images and PDFs go only to this turn's model call.
  const texts = mediaTexts(promptTexts(env.locale));
  const history = [...loaded.history];
  const withMedia = async (key: TurnKey): Promise<PreparedMedia> => {
    if (!deps.media?.length) return { notes: [], parts: [] };
    const prepared = await prepareMedia(
      deps.media,
      { ...key, voice: loaded.voice },
      texts,
      {
        ...(deps.createTranscription
          ? { createTranscription: deps.createTranscription }
          : {}),
      },
    );
    if (prepared.notes.length > 0) {
      const notes = prepared.notes.join("\n").slice(0, 100_000);
      const message = await session.transaction(async (tx) => {
        await tx.aiMessage.create({
          data: {
            conversationId: loaded.conversationId,
            role: "user",
            content: notes,
          },
          select: { id: true },
        });
        return tx.aiMessage.findFirst({
          where: { id: payload.messageId },
          select: { content: true },
        });
      });
      // The model reads the message and its files as one; a message of
      // files only has no text in the history.
      const last = history.at(-1);
      const base = typeof last?.content === "string" ? last.content : "";
      if (last?.role === "user" && base !== "" && message?.content) {
        history[history.length - 1] = {
          role: "user",
          content: `${base}\n${notes}`,
        };
      } else {
        history.push({ role: "user", content: notes });
      }
    }
    return prepared;
  };
  const messagesWith = (
    parts: PreparedMedia["parts"],
    note: string | null,
  ): ModelMessage[] => {
    const last = history.at(-1);
    if (last?.role !== "user" || typeof last.content !== "string") {
      return history;
    }
    const text = note ? `${last.content}\n${note}` : last.content;
    if (parts.length === 0 && !note) return history;
    return [
      ...history.slice(0, -1),
      {
        role: "user",
        content: parts.length > 0 ? [{ type: "text", text }, ...parts] : text,
      },
    ];
  };

  // The tools keep their state between the two attempts: a contact
  // created by the first is not created again by the second.
  const instructions = [
    loaded.systemPrompt,
    loaded.hoursNote,
    ...(loaded.referralsNote ? [loaded.referralsNote] : []),
    ...(deps.answerLimits
      ? [limitsInstruction(env.locale, deps.answerLimits)]
      : []),
    ...[contactLocaleInstruction(env.locale, deps.contactLocale)].filter(
      (note): note is string => note !== null,
    ),
    // What the reception passed on is data, never an instruction (GF2).
    ...(loaded.handover
      ? [
          format(promptTexts(env.locale).delegation.note, {
            data: handoverData(
              loaded.handover.reason,
              loaded.handover.summary,
            ),
          }),
        ]
      : []),
  ].join("\n\n");
  const answerOnce = async (key: TurnKey, messages: ModelMessage[]) => {
    // A specialist has what is left of the budget of the whole turn.
    const totalMs = specialist
      ? Math.max(
          1,
          Math.min(
            TURN_LIMITS.totalMs,
            remainingMs(
              run.startedAt,
              TURN_LIMITS.delegationTotalMs,
              Date.now(),
            ),
          ),
        )
      : TURN_LIMITS.totalMs;
    const result = await generateText({
      model: (deps.createModel ?? createChatModel)(key),
      instructions,
      messages,
      tools: buildTools(env),
      output: Output.object({ schema: ResponsePlan }),
      // The orchestrator stops at the hand-over: the specialist answers.
      stopWhen: [
        isStepCount(TURN_LIMITS.maxSteps),
        () => state.delegation !== undefined,
      ],
      maxOutputTokens: TURN_LIMITS.maxOutputTokens,
      timeout: { totalMs },
      maxRetries: 1,
      repairToolCall: async ({ toolCall, error }) => {
        if (NoSuchToolError.isInstance(error)) {
          recordRefusedCall(
            env,
            toolCall.toolName,
            toolCall.toolCallId,
            toolCall.input,
          );
        }
        return null;
      },
    });
    const usage = {
      inputTokens: result.totalUsage.inputTokens ?? 0,
      outputTokens: result.totalUsage.outputTokens ?? 0,
    };
    if (state.delegation) {
      return { answer: null, steps: result.steps, usage };
    }
    return {
      answer: ResponsePlan.parse(result.output),
      steps: result.steps,
      usage,
    };
  };
  // Read once, with the turn's first key; the platform's backup answers
  // in text only.
  const media = await withMedia(loaded.key);
  const answerWith = async (key: TurnKey) => {
    const parts = key.source === "customer" ? media.parts : [];
    if (parts.length === 0 && media.parts.length > 0) {
      return answerOnce(key, messagesWith([], texts.unreadable));
    }
    try {
      return await answerOnce(key, messagesWith(parts, null));
    } catch (error) {
      // A model that cannot open the files answers without them, asking
      // the contact to write; a failing key is handled by the caller.
      if (parts.length === 0 || turnErrorCode(error) !== "provider_error") {
        throw error;
      }
      appLog.warn("ai.turn.media_refused", { executionId });
      return answerOnce(key, messagesWith([], texts.unreadable));
    }
  };
  // A specialist's invalid output gets one new try before it goes to the
  // team (GF2, budget of the turn).
  const attempt = async (key: TurnKey) => {
    try {
      return await answerWith(key);
    } catch (error) {
      if (!specialist || turnErrorCode(error) !== "invalid_output") throw error;
      appLog.warn("ai.turn.specialist_retry", { executionId });
      return answerWith(key);
    }
  };

  // Whose key answered, for the usage; the backup is a courtesy (§9.2).
  const usageOwner = (source: TurnKey["source"]): UsageOwner => ({
    keySource: source,
    partnerId: null,
    organizationId: ctx.organizationId,
    workspaceId: ctx.workspaceId,
  });
  /** `counted`: the failed call is already in the usage (key failure). */
  const fail = async (
    key: TurnKey,
    error: unknown,
    counted = false,
  ): Promise<Run> => {
    const errorCode = turnErrorCode(error);
    appLog.warn("ai.turn.failed", {
      executionId,
      errorCode,
      keySource: key.source,
      status: APICallError.isInstance(error) ? error.statusCode : undefined,
    });
    await session.transaction((tx) =>
      persistTurnError(tx, {
        ...turn,
        errorCode,
        provider: key.provider,
        model: key.model,
        ...(counted ? {} : { owner: usageOwner(key.source) }),
        records: state.records,
      }),
    );
    // A specialist that cannot answer in time or in shape: the team takes
    // the conversation, with the reason (GF2).
    if (
      specialist &&
      loaded.delegation.returnTo &&
      loaded.specialistRole &&
      (errorCode === "invalid_output" ||
        errorCode === "timeout" ||
        // Any other failure of the specialist in the turn of the hand-over
        // would leave the contact without an answer: the team takes it.
        loaded.handover !== null)
    ) {
      const code =
        errorCode === "invalid_output" || errorCode === "timeout"
          ? errorCode
          : "unavailable";
      return {
        kind: "finished",
        value: await handToTeam(session, {
          audit,
          conversationId: loaded.conversationId,
          executionId,
          agentId: loaded.delegation.returnTo,
          role: loaded.specialistRole,
          language: config.overview.language,
          code,
          summary: loaded.handover?.summary ?? "—",
          state,
        }),
      };
    }
    throw new AppError({
      code: "provider_error",
      safeMessage: "O modelo do agente não respondeu.",
    });
  };

  let key = loaded.key;
  let outcome: Awaited<ReturnType<typeof attempt>>;
  try {
    outcome = await attempt(key);
  } catch (error) {
    const errorCode = turnErrorCode(error);
    if (key.source !== "customer" || !isKeyFailure(errorCode)) {
      return fail(key, error);
    }
    appLog.warn("ai.turn.key_failed", { executionId, errorCode });
    const backup = await session.transaction(async (tx) => {
      const started = await startKeyBackup(tx, loaded.agentId);
      await persistKeyFailure(tx, {
        ...turn,
        errorCode,
        started: started?.started ?? false,
        failed: {
          provider: key.provider,
          model: key.model,
          owner: usageOwner("customer"),
        },
        records: state.records,
      });
      if (
        !started ||
        !backupServes(loaded.conversationCreatedAt, started.startedAt, now())
      ) {
        return null;
      }
      const backupKey = await loadBackupKey(tx, loaded.agentId);
      return backupKey ? withBaseUrl(tx, backupKey) : null;
    });
    // Already in the audit with the failure.
    state.records.length = 0;
    if (!backup) return fail(key, error, true);
    key = { ...backup, source: "backup" };
    try {
      outcome = await attempt(key);
    } catch (backupError) {
      return fail(key, backupError);
    }
  }

  const used = key;
  const delegation = state.delegation;
  const tested = await session.transaction(async (tx) => {
    await persistTurn(tx, {
      ...turn,
      provider: used.provider,
      model: used.model,
      steps: outcome.steps,
      // The orchestrator that hands over writes no answer (GF2).
      answer: outcome.answer?.messages ?? [],
      usage: outcome.usage,
      records: state.records,
      owner: usageOwner(used.source),
    });
    if (used.source === "backup") {
      await tx.aiConversation.updateMany({
        where: { id: loaded.conversationId, keyMode: "own" },
        data: { keyMode: "backup" },
      });
    }
    if (delegation) {
      await persistDelegation(
        tx,
        turn,
        { role: delegation.to, agentId: delegation.agentId },
        now(),
      );
    } else if (loaded.delegation.returnTo) {
      // The specialist gave the conversation back, or handed it to the
      // team: either way the conversation is no longer its own.
      if (state.returned) {
        await persistDelegationEnd(tx, turn, {
          action: "ai_agents.guid.return",
          role: loaded.specialistRole ?? "specialist",
        });
      } else if (state.status === "handoff") {
        await tx.aiConversation.updateMany({
          where: { id: loaded.conversationId },
          data: { delegatedAgentId: null, delegatedUntil: null },
        });
      } else if (!loaded.handover) {
        // Confirmed: the contact's message moves the deadline 24 h on.
        await tx.aiConversation.updateMany({
          where: { id: loaded.conversationId, delegatedAgentId: { not: null } },
          data: { delegatedUntil: delegationUntil(now()) },
        });
      }
    }
    // The platform's key proves nothing about the customer's; and what a
    // specialist answered in the orchestrator's test is not its own test.
    if (
      !loaded.test ||
      used.source !== "customer" ||
      !loaded.configHash ||
      specialist
    ) {
      return false;
    }
    const rows = await tx.$queryRaw<{ passed: boolean }[]>`
      select private.ai_agent_test_passed(${loaded.agentId}::uuid, ${loaded.configHash}) as passed
    `;
    return rows[0]?.passed === true;
  });
  if (delegation) return { kind: "delegated", delegation, state, tested };
  const answer = outcome.answer;
  if (!answer) throw new Error("turn without an answer");
  // The voice answers only with the customer's keys; text otherwise.
  const spoken =
    deps.speak && used.source === "customer" && loaded.voice?.speaks
      ? await speakAnswer(answer.messages, loaded.voice, {
          ...(deps.createSpeech ? { createSpeech: deps.createSpeech } : {}),
          ...(deps.convertAudio ? { convert: deps.convertAudio } : {}),
        })
      : null;
  return {
    kind: "finished",
    value: {
      result: {
        status: state.status,
        ...(loaded.test ? { tested: tested ? 1 : 0 } : {}),
        keySource: used.source,
        messages: answer.messages.length,
        tools: state.records.length,
        ...(spoken ? { spoken: 1 } : {}),
      },
      state,
      spoken,
    },
  };
}

/** The job; tests build one with a mock model. */
export function createGuidTurnJob(deps: GuidTurnDeps = {}) {
  return defineDetachedJob<GuidTurnPayload>({
    kind: GUID_TURN_JOB_KIND,
    description: "Resposta de um GUIDS a uma mensagem da conversa.",
    payload: GuidTurnPayload,
    // A model call is not repeated by the queue: the turn records its own
    // error and, when the customer's key fails, tries the backup itself.
    maxAttempts: 1,
    expireInSeconds: 180,
    run: (session, ctx, payload) => runGuidTurn(session, ctx, payload, deps),
  });
}

export const guidTurnJob = createGuidTurnJob();
