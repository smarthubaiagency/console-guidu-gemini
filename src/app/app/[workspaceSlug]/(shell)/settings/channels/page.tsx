import type { Metadata } from "next";
import { Inbox } from "lucide-react";
import { notFound, unstable_rethrow } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { requireUserPage } from "@/core/auth/page-guard";
import {
  type ChannelConnectionDto,
  listChannelConnections,
} from "@/core/channels/connections";
import { describeInboxOwners, type InboxOwner } from "@/core/channels/registry";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { Permissions } from "@/core/permissions/catalog";
import { hasWorkspaceRolePermission } from "@/core/permissions/matrix";
import type { WorkspaceRole } from "@/core/permissions/roles";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";

import { ChannelsClient } from "./channels-client";
import { requireWorkspaceAreaPage } from "@/core/module-runtime/page-access";

/**
 * Configurações › Canais (A5a, ADR 0011): the workspace's connections to
 * messaging providers. Owner, admin and editor see them; owner and admin
 * connect Chatwoot, check and remove a connection. Which agent answers
 * each inbox is set on the agent (A5b); the card shows it, with the
 * service of the last days (A5c).
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("channels");
  return { title: t("metaTitle") };
}

interface ChannelsPageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function ChannelsSettingsPage({
  params,
}: ChannelsPageProps) {
  const { workspaceSlug } = await params;
  const identity = await requireUserPage(
    `/app/${workspaceSlug}/settings/channels`,
  );
  const t = await getTranslations("channels");
  let context;
  try {
    context = await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      workspaceSlug,
    );
  } catch (error) {
    unstable_rethrow(error);
    notFound();
  }
  // Areas beyond the dashboard need workspace.read (AT1).
  await requireWorkspaceAreaPage(context);

  const view = await withContext(prisma, context, async (tx) => {
    const member = await tx.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: context.workspaceId,
          userId: context.userId,
        },
      },
    });
    const role =
      member?.status === "active" ? (member.role as WorkspaceRole) : null;
    const canRead =
      role !== null &&
      hasWorkspaceRolePermission(role, Permissions.CHANNELS_READ);
    const canManage =
      role !== null &&
      hasWorkspaceRolePermission(role, Permissions.CHANNELS_MANAGE);
    const connections: ChannelConnectionDto[] = canRead
      ? await listChannelConnections(tx, context)
      : [];
    const owners: Record<string, InboxOwner> = canRead
      ? await describeInboxOwners(tx, context)
      : {};
    return { canRead, canManage, connections, owners };
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="border-border border-b pb-5">
        <div className="flex items-center gap-3">
          <div className="bg-surface-hover text-text-subtle rounded-lg p-2">
            <Inbox className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-20 text-text font-bold tracking-tight">
              {t("title")}
            </h1>
            <p className="text-12 text-text-secondary">{t("description")}</p>
          </div>
        </div>
      </div>
      {view.canRead ? (
        <ChannelsClient
          workspaceSlug={workspaceSlug}
          connections={view.connections}
          owners={view.owners}
          canManage={view.canManage}
        />
      ) : (
        <p className="text-12 text-text-secondary">{t("noAccess")}</p>
      )}
    </div>
  );
}
