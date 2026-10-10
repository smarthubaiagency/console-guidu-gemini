import type { Metadata } from "next";
import { Bot } from "lucide-react";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { listApiKeys } from "@/core/credentials/api-keys";
import { Permissions } from "@/core/permissions/catalog";
import { hasWorkspaceRolePermission } from "@/core/permissions/matrix";
import type { WorkspaceRole } from "@/core/permissions/roles";
import { McpKeysClient, type McpKeysCapabilities } from "./mcp-keys-client";

export const metadata: Metadata = {
  title: "Assistentes conectados (MCP) — Configurações",
};

interface McpSettingsPageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function McpSettingsPage({ params }: McpSettingsPageProps) {
  const { workspaceSlug } = await params;
  const currentPath = `/app/${workspaceSlug}/settings/mcp`;
  const identity = await requireUserPage(currentPath);

  const context = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );

  const { apiKeys, capabilities, userRole } = await withContext(
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
          isViewer: wsRole === "viewer",
        } satisfies McpKeysCapabilities,
        userRole: wsRole,
      };
    },
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="border-border border-b pb-5">
        <div className="text-12 text-text-secondary mb-1 flex items-center gap-2 font-medium">
          <span>Configurações</span>
          <span>/</span>
          <span>Assistentes conectados (MCP)</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-surface-hover text-text-subtle rounded-lg p-2">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-20 text-text font-bold tracking-tight">
              Assistentes conectados (MCP)
            </h1>
            <p className="text-12 text-text-secondary">
              Conforme ADR 0009: tokens pessoais com hash SHA-256 e expiração
              obrigatória para conexões de desenvolvedor e assistentes de IA (Cursor, Claude Code, Codex).
            </p>
          </div>
        </div>
      </div>

      <McpKeysClient
        workspaceSlug={workspaceSlug}
        apiKeys={apiKeys}
        capabilities={capabilities}
        currentUserId={context.userId}
        userRole={userRole}
      />
    </div>
  );
}
