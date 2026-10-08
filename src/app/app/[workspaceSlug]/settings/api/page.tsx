import type { Metadata } from "next";
import { Key } from "lucide-react";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveWorkspaceContext } from "@/core/auth/context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { listApiKeys } from "@/core/credentials/api-keys";
import { ApiKeysClient } from "./api-keys-client";

export const metadata: Metadata = {
  title: "Chaves de API & Conexões MCP",
};

interface ApiKeysPageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function ApiSettingsPage({ params }: ApiKeysPageProps) {
  const { workspaceSlug } = await params;
  const currentPath = `/app/${workspaceSlug}/settings/api`;
  const identity = await requireUserPage(currentPath);

  const context = await resolveWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );

  const apiKeys = await withContext(prisma, context, async (tx) => {
    return listApiKeys(tx, context.workspaceId);
  });

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="border-b border-neutral-200 pb-5">
        <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 mb-1">
          <span>Configurações</span>
          <span>/</span>
          <span>Chaves de API</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-neutral-100 text-neutral-700">
            <Key className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-neutral-900">
              Chaves de API e Tokens MCP
            </h1>
            <p className="text-xs text-neutral-500">
              Conforme ADR 0009: tokens pessoais com hash SHA-256 e expiração obrigatória para conexões de desenvolvedor e assistentes de IA.
            </p>
          </div>
        </div>
      </div>

      <ApiKeysClient
        workspaceSlug={workspaceSlug}
        apiKeys={apiKeys}
      />
    </div>
  );
}
