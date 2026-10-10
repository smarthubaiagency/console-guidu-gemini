/**
 * ============================================================================
 * File: src/app/app/[workspaceSlug]/ai-agents/page.tsx
 * Module: AI Prompt & Agents Workspace Module Page
 *
 * Maintenance Rationale:
 * - Server component protecting access via workspace membership (ADR 0001).
 * - Queries active agent configurations and chat history inside `withContext`.
 * - Passes strictly sanitized models and interaction metrics to the client UI.
 * ============================================================================
 */

import type { Metadata } from "next";
import { Bot, Clock } from "lucide-react";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { isModuleTechnicallyAvailable } from "@/core/modules/availability";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import {
  listAgentConfigs,
  listAgentSessions,
  getSessionWithMessages,
  type AgentMessageData,
} from "@/core/agents/engine";
import { AgentsClient } from "./agents-client";

export const metadata: Metadata = {
  title: "Agentes de IA e Motor de Execução Resiliente",
};

interface AiAgentsPageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function AiAgentsPage({ params }: AiAgentsPageProps) {
  const { workspaceSlug } = await params;
  const currentPath = `/app/${workspaceSlug}/ai-agents`;
  const identity = await requireUserPage(currentPath);

  const context = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );

  if (!isModuleTechnicallyAvailable("ai-agents")) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="border-border border-b pb-5">
          <div className="text-12 text-text-secondary mb-1 flex items-center gap-2 font-medium">
            <span>Módulos</span>
            <span>/</span>
            <span>Agentes de IA</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="bg-info-bg text-info-text border-info-border rounded-lg border p-2">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-20 text-text font-bold tracking-tight">
                Agentes de Inteligência Artificial & Motor de Prompts
              </h1>
              <p className="text-12 text-text-secondary">
                Assistentes contextuais com execução redundante (fallbacks
                automáticos), chaves BYOK e trilha de auditoria.
              </p>
            </div>
          </div>
        </div>

        <div className="border-border bg-surface-sidebar rounded-2xl border p-8 text-center">
          <div className="bg-info-bg text-info-text mx-auto flex h-10 w-10 items-center justify-center rounded-xl">
            <Clock className="h-5 w-5" />
          </div>
          <h2 className="text-14 text-text mt-4 font-semibold">
            Módulo Indisponível
          </h2>
          <p className="text-12 text-text-secondary mx-auto mt-2 max-w-md leading-relaxed">
            Conforme ADR 0003 e decisão de governança (C04), o módulo de Agentes de IA está congelado
            e indisponível até a definição formal da especificação de produto e do registro de módulos da Fase 2.
          </p>
        </div>
      </div>
    );
  }

  const { configs, sessions, initialMessages } = await withContext(
    prisma,
    context,
    async (tx) => {
      const configsList = await listAgentConfigs(tx, context.workspaceId);
      const sessionsList = await listAgentSessions(tx, context.workspaceId);
      let messagesList: AgentMessageData[] = [];
      if (sessionsList.length > 0 && sessionsList[0]) {
        const sessionData = await getSessionWithMessages(
          tx,
          sessionsList[0].id,
        );
        messagesList = sessionData.messages;
      }
      return {
        configs: configsList,
        sessions: sessionsList,
        initialMessages: messagesList,
      };
    },
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="border-border border-b pb-5">
        <div className="text-12 text-text-secondary mb-1 flex items-center gap-2 font-medium">
          <span>Módulos</span>
          <span>/</span>
          <span>Agentes de IA</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-info-bg text-info-text border-info-border rounded-lg border p-2">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-20 text-text font-bold tracking-tight">
              Agentes de Inteligência Artificial & Motor de Prompts
            </h1>
            <p className="text-12 text-text-secondary">
              Assistentes contextuais com execução redundante (fallbacks
              automáticos), chaves BYOK e trilha de auditoria.
            </p>
          </div>
        </div>
      </div>

      <AgentsClient
        workspaceSlug={workspaceSlug}
        initialConfigs={configs}
        initialSessions={sessions}
        initialMessages={initialMessages}
      />
    </div>
  );
}
