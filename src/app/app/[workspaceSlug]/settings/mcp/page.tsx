import type { Metadata } from "next";
import { Bot } from "lucide-react";
import { getTranslations } from "next-intl/server";
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

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("mcp");
  return { title: t("metaTitle") };
}

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
  const t = await getTranslations("mcp");
  const code = (chunks: React.ReactNode) => <code>{chunks}</code>;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="border-border border-b pb-5">
        <div className="text-12 text-text-secondary mb-1 flex items-center gap-2 font-medium">
          <span>{t("breadcrumbSettings")}</span>
          <span>/</span>
          <span>{t("title")}</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-surface-hover text-text-subtle rounded-lg p-2">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-20 text-text font-bold tracking-tight">
              {t("title")}
            </h1>
            <p className="text-12 text-text-secondary">{t("description")}</p>
          </div>
        </div>
      </div>

      <section
        className="border-card-border bg-surface-card space-y-2 rounded-xl border p-4 shadow-xs"
        data-testid="mcp-connect"
      >
        <h2 className="text-14 text-text font-semibold">{t("howToConnect")}</h2>
        <p className="text-12 text-text-secondary">
          {t.rich("serverUrl", {
            url: mcpUrl,
            header: `Authorization: Bearer <${t("headerKeyPlaceholder")}>`,
            code,
            urlCode: (chunks) => (
              <code className="text-text" data-testid="mcp-url">
                {chunks}
              </code>
            ),
          })}
        </p>
        <p className="text-12 text-text-secondary">{t("claudeCode")}</p>
        <pre className="text-11 bg-surface-sidebar border-border overflow-x-auto rounded-lg border p-2">
          {`claude mcp add --transport http guidu ${mcpUrl} \\\n  --header "Authorization: Bearer <${t("commandKeyPlaceholder")}>"`}
        </pre>
        <p className="text-12 text-text-secondary">
          {t.rich("codex", { code })}
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
