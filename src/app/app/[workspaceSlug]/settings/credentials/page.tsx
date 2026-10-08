import type { Metadata } from "next";
import { KeyRound } from "lucide-react";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveWorkspaceContext } from "@/core/auth/context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { listWorkspaceCredentials } from "@/core/credentials/vault";
import { CredentialsClient } from "./credentials-client";

export const metadata: Metadata = {
  title: "Credenciais e Provedores de IA (BYOK)",
};

interface CredentialsPageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function CredentialsSettingsPage({ params }: CredentialsPageProps) {
  const { workspaceSlug } = await params;
  const currentPath = `/app/${workspaceSlug}/settings/credentials`;
  const identity = await requireUserPage(currentPath);

  const context = await resolveWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );

  const credentials = await withContext(prisma, context, async (tx) => {
    return listWorkspaceCredentials(tx, context.workspaceId);
  });

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="border-b border-neutral-200 pb-5">
        <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 mb-1">
          <span>Configurações</span>
          <span>/</span>
          <span>Credenciais BYOK</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-neutral-100 text-neutral-700">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-neutral-900">
              Credenciais de Provedores de IA (BYOK)
            </h1>
            <p className="text-xs text-neutral-500">
              Conecte chaves de API da OpenAI, Google Gemini e Anthropic com cifragem AES-256-GCM em repouso.
            </p>
          </div>
        </div>
      </div>

      <CredentialsClient
        workspaceSlug={workspaceSlug}
        credentials={credentials}
      />
    </div>
  );
}
