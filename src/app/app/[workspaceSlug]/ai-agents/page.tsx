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
import { Bot } from "lucide-react";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveWorkspaceContext } from "@/core/auth/context";
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

  const context = await resolveWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );

  const { configs, sessions, initialMessages } = await withContext(prisma, context, async (tx) => {
    const configsList = await listAgentConfigs(tx, context.workspaceId);
    const sessionsList = await listAgentSessions(tx, context.workspaceId);
    let messagesList: AgentMessageData[] = [];
    if (sessionsList.length > 0 && sessionsList[0]) {
      const sessionData = await getSessionWithMessages(tx, sessionsList[0].id);
      messagesList = sessionData.messages;
    }
    return { configs: configsList, sessions: sessionsList, initialMessages: messagesList };
  });

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="border-b border-neutral-200 pb-5">
        <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 mb-1">
          <span>Módulos</span>
          <span>/</span>
          <span>Agentes de IA</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-50 text-blue-700 border border-blue-200">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-neutral-900">
              Agentes de Inteligência Artificial & Motor de Prompts
            </h1>
            <p className="text-xs text-neutral-500">
              Assistentes contextuais com execução redundante (fallbacks automáticos), chaves BYOK e trilha de auditoria.
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
