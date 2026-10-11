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
import { getRequestOrigin } from "@/core/partners/resolve";
import { McpKeysClient, type McpKeysCapabilities } from "./mcp-keys-client";

export const metadata: Metadata = {
  title: "Assistentes conectados (MCP) — Configurações",
};

interface McpSettingsPageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function McpSettingsPage({
  params,
}: McpSettingsPageProps) {
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

  // Workspace MCP endpoint (F4b): the key decides the workspace.
  const mcpUrl = `${(await getRequestOrigin()) ?? ""}/mcp/workspace`;

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
              obrigatória para conexões de desenvolvedor e assistentes de IA
              (Cursor, Claude Code, Codex).
            </p>
          </div>
        </div>
      </div>

      <section
        className="border-card-border bg-surface-card space-y-2 rounded-xl border p-4 shadow-xs"
        data-testid="mcp-connect"
      >
        <h2 className="text-14 text-text font-semibold">Como conectar</h2>
        <p className="text-12 text-text-secondary">
          Endereço do servidor MCP (Streamable HTTP):{" "}
          <code className="text-text" data-testid="mcp-url">
            {mcpUrl}
          </code>
          . Use uma chave deste workspace no cabeçalho{" "}
          <code>Authorization: Bearer &lt;sua chave&gt;</code>. As ferramentas
          disponíveis dependem dos escopos da chave e do seu papel; nenhuma
          ferramenta altera dados.
        </p>
        <p className="text-12 text-text-secondary">Claude Code:</p>
        <pre className="text-11 bg-surface-sidebar border-border overflow-x-auto rounded-lg border p-2">
          {`claude mcp add --transport http guidu ${mcpUrl} \\\n  --header "Authorization: Bearer <SUA_CHAVE>"`}
        </pre>
        <p className="text-12 text-text-secondary">
          Codex (<code>~/.codex/config.toml</code>, com a chave na variável{" "}
          <code>GUIDU_MCP_TOKEN</code>):
        </p>
        <pre className="text-11 bg-surface-sidebar border-border overflow-x-auto rounded-lg border p-2">
          {`[mcp_servers.guidu]\nurl = "${mcpUrl}"\nbearer_token_env_var = "GUIDU_MCP_TOKEN"`}
        </pre>
      </section>

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
