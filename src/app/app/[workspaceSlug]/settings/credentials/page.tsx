import type { Metadata } from "next";
import { KeyRound } from "lucide-react";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveWorkspaceContext } from "@/core/auth/context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { listWorkspaceCredentials } from "@/core/credentials/vault";
import { Permissions } from "@/core/permissions/catalog";
import { hasWorkspaceRolePermission } from "@/core/permissions/matrix";
import type { WorkspaceRole } from "@/core/permissions/roles";
import {
  CredentialsClient,
  type CredentialsCapabilities,
} from "./credentials-client";

export const metadata: Metadata = {
  title: "Credenciais e Provedores de IA (BYOK)",
};

interface CredentialsPageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function CredentialsSettingsPage({
  params,
}: CredentialsPageProps) {
  const { workspaceSlug } = await params;
  const currentPath = `/app/${workspaceSlug}/settings/credentials`;
  const identity = await requireUserPage(currentPath);

  const context = await resolveWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );

  const { credentials, capabilities } = await withContext(
    prisma,
    context,
    async (tx) => {
      const wsMember = await tx.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: context.workspaceId,
            userId: context.userId,
          },
        },
      });

      const wsRole =
        wsMember?.status === "active" ? (wsMember.role as WorkspaceRole) : null;

      const canRead = wsRole
        ? hasWorkspaceRolePermission(wsRole, Permissions.CREDENTIALS_READ)
        : false;
      const canManage = wsRole
        ? hasWorkspaceRolePermission(wsRole, Permissions.CREDENTIALS_MANAGE)
        : false;

      const creds = canRead
        ? await listWorkspaceCredentials(tx, context)
        : [];

      return {
        credentials: creds,
        capabilities: {
          canManage,
          canRead,
        } satisfies CredentialsCapabilities,
      };
    },
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="border-border border-b pb-5">
        <div className="text-12 text-text-secondary mb-1 flex items-center gap-2 font-medium">
          <span>Configurações</span>
          <span>/</span>
          <span>Credenciais BYOK</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-surface-hover text-text-subtle rounded-lg p-2">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-20 text-text font-bold tracking-tight">
              Credenciais de Provedores de IA (BYOK)
            </h1>
            <p className="text-12 text-text-secondary">
              Conecte chaves de API da OpenAI, Google Gemini e Anthropic com
              cifragem AES-256-GCM em repouso.
            </p>
          </div>
        </div>
      </div>

      <CredentialsClient
        workspaceSlug={workspaceSlug}
        credentials={credentials}
        capabilities={capabilities}
      />
    </div>
  );
}
