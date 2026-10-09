import type { Metadata } from "next";
import { Key } from "lucide-react";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveWorkspaceContext } from "@/core/auth/context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { listApiKeys } from "@/core/credentials/api-keys";
import { Permissions } from "@/core/permissions/catalog";
import { hasWorkspaceRolePermission } from "@/core/permissions/matrix";
import type { WorkspaceRole } from "@/core/permissions/roles";
import {
  ApiKeysClient,
  type ApiKeysCapabilities,
} from "./api-keys-client";

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

  const { apiKeys, capabilities } = await withContext(
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

      const canCreate = wsRole
        ? hasWorkspaceRolePermission(wsRole, Permissions.API_KEYS_CREATE_OWN)
        : false;
      const canRevokeOwn = wsRole
        ? hasWorkspaceRolePermission(wsRole, Permissions.API_KEYS_REVOKE_OWN)
        : false;
      const canRevokeAny = wsRole
        ? hasWorkspaceRolePermission(wsRole, Permissions.API_KEYS_REVOKE_ANY)
        : false;

      const keys = wsRole ? await listApiKeys(tx, context) : [];

      return {
        apiKeys: keys,
        capabilities: {
          canManage: canCreate || canRevokeAny,
          canCreate,
          canRevokeOwn,
          canRevokeAny,
        } satisfies ApiKeysCapabilities,
      };
    },
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="border-border border-b pb-5">
        <div className="text-12 text-text-secondary mb-1 flex items-center gap-2 font-medium">
          <span>Configurações</span>
          <span>/</span>
          <span>Chaves de API</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-surface-hover text-text-subtle rounded-lg p-2">
            <Key className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-20 text-text font-bold tracking-tight">
              Chaves de API e Tokens MCP
            </h1>
            <p className="text-12 text-text-secondary">
              Conforme ADR 0009: tokens pessoais com hash SHA-256 e expiração
              obrigatória para conexões de desenvolvedor e assistentes de IA.
            </p>
          </div>
        </div>
      </div>

      <ApiKeysClient
        workspaceSlug={workspaceSlug}
        apiKeys={apiKeys}
        capabilities={capabilities}
        currentUserId={context.userId}
      />
    </div>
  );
}
