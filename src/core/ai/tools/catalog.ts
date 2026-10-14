import "server-only";

import type { PrismaClient } from "@prisma/client";
import { tool, type ToolSet } from "ai";
import { z } from "zod";

import type { ApiCall } from "@/core/api/handler";
import { assertModuleOperational } from "@/core/module-runtime/state";
import { requireWorkspacePermission } from "@/core/permissions/guard";
import { listProposalOperations } from "@/core/proposals/registry";
import { createAssistantProposal } from "@/core/proposals/service";
import type { RequestContext } from "@/lib/prisma/with-context";
import { appLog } from "@/lib/telemetry/log";
import { createContact, getContact, updateContact } from "@/modules/crm/server";
import { agentItemFiles } from "@/modules/portfolio/server/services/catalog";
import { AppError } from "@/shared/errors";

import type { AgentConfig } from "../config/schema";
import { scoreLead } from "../config/scoring";
import {
  recordLeadNotice,
  recordReferralNotice,
  shouldNotice,
} from "../notices/lead";
import {
  AGENT_TOOL_IDS,
  type AgentKind,
  type AgentTool,
  toolAllowedFor,
} from "../config/tools";
import { format, promptTexts, type PromptLocale } from "../prompt/texts";
import {
  MAX_CONVERSATION_VARIABLES,
  MAX_OUTBOX,
  type TurnDb,
  type TurnState,
} from "../turn/types";
import {
  callRecord,
  decideTool,
  guardToolCall,
  ToolRestrictedError,
} from "./guard";

/**
 * The tools of a turn (especificação §8, A2b), built per turn with the
 * turn's context in closures: workspace, agent, conversation and contact
 * come from the server, never from an argument. Only the tools of the
 * agent's allowlist are offered; each call still goes through the guard,
 * and each effect opens its own short transaction through the services of
 * the owning module, with the permissions of who talks.
 *
 * In a test of a GUIDS ("Testar agente", A4b, §5.3) the tools are
 * simulated: they check what they check for real and answer what they would
 * do, with `simulated: true`, without writing the contact, the note, the
 * score, the handoff or the proposal. The memory of the test conversation
 * is the test's own and is written.
 */

export type ToolEnv = Readonly<{
  kind: AgentKind;
  executionId: string;
  agentId: string;
  conversationId: string;
  config: AgentConfig;
  locale: PromptLocale;
  db: TurnDb;
  /** Workspace of the turn: the GUIDS's, or the /app of the Assistant. */
  workspace: RequestContext | null;
  /** Client of the request, for `workspace_read` (Assistant only). */
  prisma: PrismaClient | null;
  now: () => Date;
  state: TurnState;
  /** A test of the agent: effects are described, not written. */
  simulate?: boolean;
}>;

/** Reads of the workspace the Assistant may use (MCP tools of risk read). */
export const WORKSPACE_READ_TOOLS = [
  "get_workspace",
  "get_workspace_overview",
  "list_enabled_modules",
  "get_module_status",
  "get_usage_summary",
  "list_workspace_members",
  "list_contacts",
  "get_contact",
  "search_catalog",
  "lookup_catalog",
  "get_product",
  "search_portfolio",
  "get_portfolio_item",
] as const;

const MAX_NOTES = 5000;

/** The contact a simulated `create_contact` stands for, in this turn. */
export const SIMULATED_CONTACT_ID = "simulated-contact";

function restricted(rule: string, reason: string): ToolRestrictedError {
  return new ToolRestrictedError(rule, reason);
}

function requireWorkspace(env: ToolEnv): RequestContext {
  if (!env.workspace) {
    throw restricted(
      "no_workspace",
      "Esta ação precisa de um workspace aberto.",
    );
  }
  return env.workspace;
}

function requireContact(env: ToolEnv): string {
  if (!env.state.contactId) {
    throw restricted(
      "no_contact",
      "A conversa ainda não tem um contato do CRM.",
    );
  }
  return env.state.contactId;
}

type Definition = Readonly<{
  description: string;
  input: z.ZodType<Record<string, unknown>>;
  run: (input: Record<string, unknown>, toolCallId: string) => Promise<unknown>;
}>;

const MESSAGE_TAG = /\{\{\s*([a-z_]+\.[a-z_]+)\s*\}\}/g;

/**
 * The message to the contact for a referral (A6b): the agent's
 * `partner_message_template` with `{{referral.*}}`, else the default text.
 */
export function referralMessage(
  env: Pick<ToolEnv, "config" | "locale">,
  referral: Readonly<{
    name: string;
    phone: string | null;
    specialties: readonly string[];
    city: string | null;
  }>,
): string {
  const texts = promptTexts(env.locale).referral;
  const values: Record<string, string> = {
    "referral.name": referral.name,
    "referral.phone": referral.phone ?? "-",
    "referral.specialties": referral.specialties.join(", ") || "-",
    "referral.city": referral.city ?? "-",
  };
  const template = env.config.rules.partner_message_template?.trim();
  if (template) {
    return template
      .replace(MESSAGE_TAG, (match, key: string) => values[key] ?? match)
      .slice(0, 2000);
  }
  return format(texts.message, {
    referral: referral.name,
    phone: referral.phone ?? "-",
  });
}

function definitions(env: ToolEnv): Record<AgentTool, Definition> {
  const conversationId = env.conversationId;
  const texts = promptTexts(env.locale);
  return {
    think: {
      description:
        "Think step by step before answering. Changes nothing and is never shown to the contact.",
      input: z.object({ thought: z.string().max(4000) }),
      run: async () => ({ noted: true }),
    },

    set_conversation_variable: {
      description:
        "Remember a short fact of this conversation (stage, intent, answers already given) under a snake_case key. " +
        `At most ${MAX_CONVERSATION_VARIABLES} keys per conversation.`,
      input: z.object({
        key: z
          .string()
          .regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/)
          .max(60),
        value: z.union([z.string().max(500), z.number(), z.boolean()]),
      }),
      run: async (input) => {
        const key = String(input.key);
        const memory = env.state.memory;
        if (
          !Object.hasOwn(memory, key) &&
          Object.keys(memory).length >= MAX_CONVERSATION_VARIABLES
        ) {
          throw restricted(
            "memory_full",
            `A memória da conversa já tem ${MAX_CONVERSATION_VARIABLES} chaves.`,
          );
        }
        const patch = JSON.stringify({ [key]: input.value });
        await env.db.transaction(async (tx) => {
          const changed = await tx.$executeRaw`
            update public.ai_conversations
            set variables = variables || ${patch}::jsonb
            where id = ${conversationId}::uuid
          `;
          if (changed !== 1) throw new Error("conversation not written");
        });
        memory[key] = input.value;
        return { saved: key };
      },
    },

    score_lead: {
      description:
        "Score the contact with the scoring rules this agent has, by rule_id, for the signals seen in the conversation. " +
        "Each rule counts once per call.",
      input: z.object({
        rule_ids: z.array(z.string().max(60)).min(1).max(30),
      }),
      run: async (input) => {
        const ws = requireWorkspace(env);
        const contactId = requireContact(env);
        const rules = env.config.rules;
        const score = scoreLead(
          rules.lead_scoring_rules ?? [],
          input.rule_ids as string[],
          { hot: rules.hot_score_threshold, warm: rules.warm_score_threshold },
        );
        if (score.breakdown.length === 0) {
          throw restricted("no_rule", "Nenhuma regra de pontuação conhecida.");
        }
        const result = {
          points: score.points,
          temperature: score.temperature,
          unknown_rule_ids: score.unknown,
        };
        if (env.simulate) return { ...result, simulated: true };
        const notice = shouldNotice(rules, {
          points: score.points,
          ruleIds: score.breakdown.map((item) => item.rule_id),
        });
        await env.db.transaction(async (tx) => {
          await tx.aiLeadActivity.create({
            data: {
              organizationId: ws.organizationId,
              workspaceId: ws.workspaceId,
              contactId,
              agentId: env.agentId,
              points: score.points,
              temperature: score.temperature,
              scoreBreakdown: score.breakdown.map((item) => ({ ...item })),
              scoringRulesVersion: rules.scoring_rules_version ?? null,
            },
            select: { id: true },
          });
          // The merchant hears of a hot lead once (A6a).
          if (notice) {
            await recordLeadNotice(tx, ws, {
              agentId: env.agentId,
              contactId,
              conversationId,
              points: score.points,
              temperature: score.temperature,
              rules,
            });
          }
        });
        return result;
      },
    },

    create_contact: {
      description:
        "Create the contact of this conversation in the CRM, once, with what the person told you.",
      input: z.object({
        name: z.string().min(1).max(160),
        email: z.string().max(254).optional(),
        phone: z.string().max(40).optional(),
        company_name: z.string().max(160).optional(),
        job_title: z.string().max(120).optional(),
      }),
      run: async (input) => {
        const ws = requireWorkspace(env);
        if (env.state.contactId) {
          throw restricted("contact_exists", "A conversa já tem um contato.");
        }
        if (env.simulate) {
          env.state.contactId = SIMULATED_CONTACT_ID;
          return { contact_id: SIMULATED_CONTACT_ID, simulated: true };
        }
        const contact = await env.db.transaction(async (tx) => {
          const created = await createContact(tx, ws, {
            name: input.name,
            email: input.email ?? null,
            phone: input.phone ?? null,
            companyName: input.company_name ?? null,
            jobTitle: input.job_title ?? null,
          });
          const linked = await tx.aiConversation.updateMany({
            where: { id: conversationId, contactId: null },
            data: { contactId: created.id },
          });
          if (linked.count !== 1) {
            throw restricted("contact_exists", "A conversa já tem um contato.");
          }
          return created;
        });
        env.state.contactId = contact.id;
        return { contact_id: contact.id };
      },
    },

    add_note: {
      description:
        "Add a short note to the contact of this conversation in the CRM.",
      input: z.object({ note: z.string().min(1).max(1000) }),
      run: async (input) => {
        const ws = requireWorkspace(env);
        const contactId = requireContact(env);
        if (env.simulate) {
          return {
            added: true,
            note: String(input.note).trim(),
            simulated: true,
          };
        }
        const stamp = env.now().toISOString().slice(0, 16).replace("T", " ");
        await env.db.transaction(async (tx) => {
          const contact = await getContact(tx, ws, contactId);
          const line = `[${stamp}] ${String(input.note).trim()}`;
          const notes = contact.notes ? `${contact.notes}\n${line}` : line;
          if (notes.length > MAX_NOTES) {
            throw restricted("notes_full", "As notas do contato estão cheias.");
          }
          await updateContact(tx, ws, contactId, { notes });
        });
        return { added: true };
      },
    },

    handoff: {
      description:
        "Hand the conversation over to a person of the team. Give the reason and a short summary for the team (who the contact is, what they want, what was already said or promised). After it, you stop answering.",
      input: z.object({
        reason: z.string().min(1).max(500),
        summary: z
          .string()
          .min(1)
          .max(1500)
          .describe(
            "For the team, not the contact: who the contact is, what they want and what was already said.",
          ),
      }),
      run: async (input) => {
        requireWorkspace(env);
        if (env.simulate) {
          // The test goes on: the person keeps testing after a handoff.
          return {
            handed_over: true,
            reason: String(input.reason),
            simulated: true,
          };
        }
        await env.db.transaction((tx) =>
          tx.aiConversation.updateMany({
            where: { id: conversationId, status: "active" },
            data: { status: "handoff" },
          }),
        );
        env.state.status = "handoff";
        env.state.handoff = {
          reason: String(input.reason).trim(),
          summary: String(input.summary).trim(),
        };
        return { handed_over: true };
      },
    },

    refer_contact: {
      description:
        "Refer the contact to one of the business's referrals (listed in your instructions), by its tag, when the request is beyond what the business does. " +
        "Give the reason in a few words. It returns the message to pass to the contact; the business is told.",
      input: z.object({
        referral_tag: z.string().min(1).max(80),
        reason: z.string().min(1).max(500),
      }),
      run: async (input) => {
        const ws = requireWorkspace(env);
        const tag = String(input.referral_tag).trim();
        const reason = String(input.reason).trim();
        const referral = await env.db.transaction((tx) =>
          tx.aiAgentReferral.findFirst({
            where: { workspaceId: ws.workspaceId, referralTag: tag },
            select: {
              id: true,
              name: true,
              phone: true,
              specialties: true,
              city: true,
            },
          }),
        );
        if (!referral) {
          throw restricted("unknown_referral", "Indicação não encontrada.");
        }
        const message = referralMessage(env, referral);
        const result = {
          referral: { name: referral.name, phone: referral.phone },
          message_for_contact: message,
        };
        if (env.simulate) return { ...result, simulated: true };
        const contactId =
          env.state.contactId && env.state.contactId !== SIMULATED_CONTACT_ID
            ? env.state.contactId
            : null;
        const stamp = env.now().toISOString().slice(0, 16).replace("T", " ");
        await env.db.transaction(async (tx) => {
          // The contact's history keeps the referral, when there is room.
          if (contactId) {
            const contact = await getContact(tx, ws, contactId);
            const line = `[${stamp}] ${format(texts.referral.note, {
              referral: referral.name,
              reason,
            })}`;
            const notes = contact.notes ? `${contact.notes}\n${line}` : line;
            if (notes.length <= MAX_NOTES) {
              await updateContact(tx, ws, contactId, { notes });
            }
          }
          // The merchant tells the referral, never GUIDU (A6b).
          if (env.config.rules.partner_referral_notify) {
            await recordReferralNotice(tx, ws, {
              agentId: env.agentId,
              contactId,
              conversationId,
              referralId: referral.id,
              reasonText: reason,
              rules: env.config.rules,
            });
          }
        });
        return result;
      },
    },

    send_portfolio_media: {
      description:
        "Send the contact an image or a document (a PDF, a sheet) of an item of the Portfolio, after your answer. " +
        `Give the item's name or id and what to send. Only the Portfolio's files are sent, at most ${MAX_OUTBOX} per answer; ` +
        "call it again for the next file of the same item.",
      input: z.object({
        item: z.string().min(1).max(200),
        media: z.enum(["image", "document"]),
      }),
      run: async (input) => {
        const ws = requireWorkspace(env);
        const outbox = (env.state.outbox ??= []);
        if (outbox.length >= MAX_OUTBOX) {
          throw restricted(
            "outbox_full",
            `Esta resposta já tem ${MAX_OUTBOX} arquivos.`,
          );
        }
        const files = await env.db.transaction((tx) =>
          agentItemFiles(tx, ws, String(input.item)),
        );
        if (!files) {
          throw restricted("not_found", "Item não encontrado no Portfólio.");
        }
        const image = input.media === "image";
        const candidates = image
          ? files.images.map((f) => ({ url: f.url, caption: f.alt }))
          : files.documents.map((f) => ({ url: f.url, caption: f.title }));
        const next = candidates.find(
          (c) => !outbox.some((queued) => queued.url === c.url),
        );
        if (!next) {
          throw restricted(
            "no_file",
            image
              ? "O item não tem outra imagem no Portfólio."
              : "O item não tem outro documento no Portfólio.",
          );
        }
        outbox.push({
          kind: input.media === "image" ? "image" : "document",
          url: next.url,
          caption: next.caption ?? files.title,
        });
        return {
          queued: true,
          item: files.title,
          media: input.media,
          ...(env.simulate ? { simulated: true } : {}),
        };
      },
    },

    // Kept in the catalog, refused by the guard until their stage.
    update_contact_property: {
      description: "Not available yet.",
      input: z.object({ key: z.string().max(80), value: z.string().max(500) }),
      run: async () => null,
    },
    add_tag: {
      description: "Not available yet.",
      input: z.object({ tag: z.string().max(60) }),
      run: async () => null,
    },
    search_knowledge: {
      description: "Not available yet.",
      input: z.object({ query: z.string().max(500) }),
      run: async () => null,
    },

    workspace_read: {
      description:
        "Read data of the open workspace with the permissions of the person you talk to. " +
        `resource is one of: ${WORKSPACE_READ_TOOLS.join(", ")}; input holds its arguments ` +
        "(for example {search, limit} for list_contacts or {contactId} for get_contact).",
      input: z.object({
        resource: z.enum(WORKSPACE_READ_TOOLS),
        input: z.record(z.string(), z.unknown()).default({}),
      }),
      run: async (input) => {
        const ws = requireWorkspace(env);
        if (!env.prisma) {
          throw restricted("no_workspace", "Leitura indisponível aqui.");
        }
        // Loaded on use: the worker never needs the MCP catalog.
        const { MCP_WORKSPACE_TOOLS } = await import("@/core/mcp/tools");
        const read = MCP_WORKSPACE_TOOLS.find(
          (t) => t.name === input.resource && t.risk === "read",
        );
        if (!read)
          throw restricted("unknown_resource", "Leitura desconhecida.");
        const args = read.input.safeParse(input.input ?? {});
        if (!args.success) {
          throw new AppError({
            code: "invalid_input",
            safeMessage: `Argumentos inválidos para ${read.name}.`,
          });
        }
        await env.db.transaction(async (tx) => {
          if (read.moduleKey) {
            await assertModuleOperational(tx, ws, read.moduleKey, "read");
          }
          await requireWorkspacePermission(tx, ws, read.permission);
        });
        const call: ApiCall = {
          requestId: env.executionId,
          partnerId: ws.partnerId ?? "",
          principal: {
            kind: "session",
            userId: ws.userId,
            mfaSatisfied: false,
          },
          context: ws,
          query: {},
          body: undefined,
          params: {},
        };
        return read.run(env.prisma, call, args.data);
      },
    },

    propose_operation: {
      description:
        "Propose a change for the person to review and approve in GUIDU (Proposals). Nothing runs now. " +
        `operation is one of: ${listProposalOperations()
          .map((op) => op.key)
          .join(
            ", ",
          )}; targetId is the record for updates; payload holds the fields.`,
      input: z.object({
        operation: z.string().min(1).max(96),
        targetId: z.uuid().optional(),
        payload: z.record(z.string(), z.unknown()),
        reason: z.string().max(500).optional(),
      }),
      run: async (input, toolCallId) => {
        const ws = requireWorkspace(env);
        if (env.simulate) {
          return {
            proposed: input.operation,
            status: "pending",
            simulated: true,
          };
        }
        const idempotencyKey = `ai.${env.executionId}.${toolCallId}`
          .replace(/[^\w.:-]/g, "_")
          .slice(0, 128);
        const { proposal } = await env.db.transaction((tx) =>
          createAssistantProposal(tx, ws, env.executionId, {
            ...input,
            idempotencyKey,
          }),
        );
        return {
          proposal_id: proposal.id,
          status: proposal.status,
          expires_at: proposal.expiresAt.toISOString(),
        };
      },
    },
  };
}

/**
 * The agent's allowlist, plus what a rule implies: a GUIDS that sends
 * out-of-scope questions to the team hands the conversation over (A6c).
 */
export function agentAllowlist(
  kind: AgentKind,
  config: AgentConfig,
): readonly string[] {
  const allowlist = config.integration.tools ?? [];
  if (
    kind === "guid" &&
    config.rules.out_of_scope_action === "escalate_team" &&
    !allowlist.includes("handoff")
  ) {
    return [...allowlist, "handoff"];
  }
  return allowlist;
}

/** The tools offered to the model: the agent's allowlist for its kind. */
export function offeredTools(
  kind: AgentKind,
  config: AgentConfig,
): AgentTool[] {
  const allowlist = agentAllowlist(kind, config);
  return AGENT_TOOL_IDS.filter(
    (id) => allowlist.includes(id) && toolAllowedFor(id, kind),
  );
}

export function buildTools(env: ToolEnv): ToolSet {
  const texts = promptTexts(env.locale);
  const allowlist = agentAllowlist(env.kind, env.config);
  const all = definitions(env);
  const tools: ToolSet = {};
  for (const id of offeredTools(env.kind, env.config)) {
    const definition = all[id];
    tools[id] = tool({
      description: definition.description,
      inputSchema: definition.input,
      execute: async (input: Record<string, unknown>, { toolCallId }) => {
        const guarded = await guardToolCall({
          tool: id,
          toolCallId,
          input,
          kind: env.kind,
          allowlist,
          run: () => definition.run(input, toolCallId),
          messages: {
            denied: texts.toolDenied,
            restricted: (reason) => format(texts.toolRestricted, { reason }),
            failed: (errorId) => format(texts.toolError, { errorId }),
          },
          onError: (errorId, error) =>
            appLog.error("ai.tool.failed", {
              errorId,
              executionId: env.executionId,
              tool: id,
              error,
            }),
        });
        env.state.records.push(guarded.record);
        return guarded.output;
      },
    });
  }
  return tools;
}

/**
 * A call to a tool that was not offered (the SDK refuses it before any
 * effect): recorded as a denial of the guard.
 */
export function recordRefusedCall(
  env: Pick<ToolEnv, "kind" | "config" | "state">,
  toolName: string,
  toolCallId: string,
  input: unknown,
): void {
  const decision = decideTool(
    toolName,
    env.kind,
    agentAllowlist(env.kind, env.config),
  );
  env.state.records.push(
    callRecord(
      toolName,
      toolCallId,
      input,
      decision.decision === "allow"
        ? {
            decision: "deny",
            rule: "not_offered",
            reason: "Ferramenta não oferecida.",
          }
        : decision,
      undefined,
    ),
  );
}
