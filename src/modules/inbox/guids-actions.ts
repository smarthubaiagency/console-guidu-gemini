"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { requireUser } from "@/core/auth/identity";
import { actionFailure } from "@/core/i18n/errors";
import { requestAgentSync } from "@/core/matrix";
import { matrixConfig } from "@/core/matrix/config";
import { changeConversation } from "@/core/matrix/conversation";
import { matrixUnavailable } from "@/core/matrix/session";
import { createSynapseClient } from "@/core/matrix/synapse";
import { resolveModulePageAccess } from "@/core/module-runtime/page-access";
import {
  getWorkspaceModuleConfig,
  saveWorkspaceModuleConfig,
} from "@/core/module-runtime/settings";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { Permissions } from "@/core/permissions/catalog";
import { prisma } from "@/lib/prisma/client";
import {
  type ContextTransaction,
  type RequestContext,
  withContext,
} from "@/lib/prisma/with-context";
import { listHubGuids } from "@/modules/ai-agents/server";
import { AppError } from "@/shared/errors";

import { loadInboxViewer, type InboxViewer } from "./server/access";
import { type GuidsPanel, loadGuidsPanel } from "./server/guids";
import {
  INBOX_SERVICE_FIELDS,
  inboxConfigOf,
  InboxServiceSettings,
} from "./settings";

/**
 * Server actions of the Inbox GUIDS (IN6): the settings (which GUIDS
 * answers and the service rules), the GUIDS card of the context panel and
 * "Devolver ao GUIDS". Each one resolves the workspace, the module and the
 * person's level again.
 */

type Failure = Readonly<{ error: string; requestId?: string }>;

export type InboxSettingsState = {
  success?: boolean;
  message?: string;
  error?: string;
  requestId?: string;
};

const slug = z.string().min(1).max(120);
const roomId = z.string().regex(/^![^\s]{1,254}$/);

function denied(): AppError {
  return new AppError({
    code: "forbidden",
    safeMessage: "Você não tem permissão para esta ação.",
    messageKey: "errors.permissionDenied",
  });
}

async function inInbox<T>(
  workspaceSlug: string,
  fn: (
    tx: ContextTransaction,
    ctx: RequestContext,
    viewer: InboxViewer,
  ) => Promise<T>,
): Promise<T> {
  const identity = await requireUser();
  const context = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );
  return withContext(prisma, context, async (tx) => {
    const access = await resolveModulePageAccess(
      tx,
      context,
      "inbox",
      Permissions.INBOX_VIEW,
    );
    const viewer = await loadInboxViewer(tx, context.userId);
    if (access.kind !== "ok" || viewer.level === null) throw denied();
    return fn(tx, context, viewer);
  });
}

export async function saveInboxSettingsAction(
  _prev: InboxSettingsState,
  formData: FormData,
): Promise<InboxSettingsState> {
  try {
    const workspaceSlug = slug.parse(formData.get("workspaceSlug"));
    const rawAgent = formData.get("guids_agent_id");
    const agentId =
      typeof rawAgent === "string" && rawAgent !== "" ? rawAgent : null;
    const service = InboxServiceSettings.safeParse(
      Object.fromEntries(
        INBOX_SERVICE_FIELDS.map((field) => [
          field.name,
          formData.get(field.name),
        ]),
      ),
    );
    if (!service.success) {
      throw new AppError({
        code: "invalid_input",
        safeMessage: "Confira as regras de atendimento.",
        messageKey: "inboxGuids.errors.invalidService",
      });
    }
    const identity = await requireUser();
    const context = await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      workspaceSlug,
    );
    await withContext(prisma, context, async (tx) => {
      const current = inboxConfigOf(
        await getWorkspaceModuleConfig(tx, context, "inbox"),
      );
      if (agentId !== null && agentId !== current.guids_agent_id) {
        // Only a GUIDS turned on is chosen (as a Chatwoot inbox, A5b).
        const choice = (await listHubGuids(tx, context)).find(
          (guids) => guids.id === agentId,
        );
        if (!choice?.active) {
          throw new AppError({
            code: "invalid_input",
            safeMessage: "Escolha um GUIDS ligado deste workspace.",
            messageKey: "inboxGuids.errors.guidsNotActive",
          });
        }
      }
      await saveWorkspaceModuleConfig(tx, context, "inbox", {
        guids_agent_id: agentId,
        service: service.data,
        // The block "Tradução" (TR2) is saved by its own form.
        translation: current.translation,
      });
      // The agent's user joins the rooms (or leaves them), by the worker.
      await requestAgentSync(tx, context.workspaceId);
    });
    revalidatePath(`/app/${workspaceSlug}/settings/modules/inbox`);
    const t = await getTranslations("inboxGuids");
    return { success: true, message: t("settings.saved") };
  } catch (error) {
    return actionFailure(error);
  }
}

const PanelInput = z.object({ workspaceSlug: slug, roomId });

export async function loadGuidsPanelAction(
  input: z.input<typeof PanelInput>,
): Promise<{ panel: GuidsPanel } | Failure> {
  try {
    const parsed = PanelInput.parse(input);
    return {
      panel: await inInbox(parsed.workspaceSlug, (tx, ctx) =>
        loadGuidsPanel(tx, ctx, parsed.roomId),
      ),
    };
  } catch (error) {
    return actionFailure(error);
  }
}

/**
 * "Devolver ao GUIDS" (plano-in4b-in6.md §5, answer 8): whoever answers
 * gives the conversation back to the GUIDS; it goes to pending, without an
 * assignee, and the GUIDS answers the consumer's next message.
 */
export async function returnToGuidsAction(
  input: z.input<typeof PanelInput>,
): Promise<{ state: { status: string; assignee: string | null } } | Failure> {
  try {
    const parsed = PanelInput.parse(input);
    const config = matrixConfig();
    if (!config) throw matrixUnavailable();
    const client = createSynapseClient(config);
    const state = await inInbox(
      parsed.workspaceSlug,
      async (tx, ctx, viewer) => {
        const panel = await loadGuidsPanel(tx, ctx, parsed.roomId);
        if (!panel.agent) {
          throw new AppError({
            code: "conflict",
            safeMessage: "Nenhum GUIDS atende o Inbox deste workspace.",
            messageKey: "inboxGuids.errors.noGuids",
          });
        }
        return changeConversation(tx, client, {
          roomId: parsed.roomId,
          action: { kind: "return" },
          actor: viewer,
        });
      },
    );
    return { state };
  } catch (error) {
    return actionFailure(error);
  }
}
