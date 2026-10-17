import type { Metadata } from "next";
import { BellRing } from "lucide-react";
import { getTranslations } from "next-intl/server";

import {
  NotificationRulesCard,
  NotificationScheduleCard,
} from "@/components/events/notification-settings";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { requireUserPage } from "@/core/auth/page-guard";
import {
  saveWorkspaceNotificationRulesAction,
  saveWorkspaceNotificationScheduleAction,
} from "@/core/events/h2-actions";
import { notificationSettingsView } from "@/core/events/rules-service";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("eventRules.settings");
  return { title: t("metaTitle") };
}

/**
 * Workspace › Configurações › Notificações (H2): what the platform and the
 * partner left open, adjusted for the workspace. Every member reads; owner
 * and admin save.
 */
export default async function WorkspaceNotificationSettingsPage({
  params,
}: Readonly<{ params: Promise<{ workspaceSlug: string }> }>) {
  const { workspaceSlug } = await params;
  const identity = await requireUserPage(
    `/app/${workspaceSlug}/settings/notifications`,
  );
  const ctx = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );
  const data = await withContext(prisma, ctx, (tx) =>
    notificationSettingsView(tx, {
      level: "workspace",
      userId: identity.userId,
      ctx,
    }),
  );
  const t = await getTranslations("eventRules.settings");
  return (
    <>
      <ModulePageHeader
        title={t("title")}
        description={t("description.workspace")}
        icon={<BellRing className="h-5 w-5" />}
      />
      <NotificationRulesCard
        data={data}
        action={saveWorkspaceNotificationRulesAction}
        hidden={{ workspaceSlug }}
      />
      <NotificationScheduleCard
        data={data}
        action={saveWorkspaceNotificationScheduleAction}
        hidden={{ workspaceSlug }}
      />
    </>
  );
}
