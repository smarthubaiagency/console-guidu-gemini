import type { Metadata } from "next";
import { BellRing } from "lucide-react";
import { getTranslations } from "next-intl/server";

import {
  NotificationRulesCard,
  NotificationScheduleCard,
  TEMPLATE_LOCALES,
  WhatsappTemplatesCard,
} from "@/components/events/notification-settings";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import {
  savePlatformNotificationRulesAction,
  savePlatformNotificationScheduleAction,
  savePlatformWhatsappTemplateAction,
} from "@/core/events/h2-actions";
import { notificationSettingsView } from "@/core/events/rules-service";
import { WHATSAPP_TEXT_TYPES } from "@/core/events/texts";
import {
  canEditTemplates,
  effectiveTemplate,
  templateVersions,
  type TemplatesActor,
} from "@/core/events/whatsapp-templates";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("eventRules.settings");
  return { title: t("metaTitle") };
}

const BASE = "/platform/settings/notifications";

/**
 * Plataforma › Configurações › Notificações (H2): the default rules of
 * every event type (and their locks), the quiet window, the digest time
 * and the base WhatsApp texts.
 */
export default async function PlatformNotificationSettingsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ template?: string; locale?: string }>;
}>) {
  const identity = await requirePlatformAdminPage(BASE);
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  const platformRole = admin?.status === "active" ? admin.role : null;
  const params = await searchParams;
  const eventType = WHATSAPP_TEXT_TYPES.includes(params.template ?? "")
    ? params.template!
    : WHATSAPP_TEXT_TYPES[0]!;
  const locale = (TEMPLATE_LOCALES as readonly string[]).includes(
    params.locale ?? "",
  )
    ? params.locale!
    : "pt-BR";
  const templatesActor: TemplatesActor = {
    level: "platform",
    userId: identity.userId,
    platformRole,
  };
  const { data, current, versions } = await withIdentityContext(
    prisma,
    identity.userId,
    async (tx) => ({
      data: await notificationSettingsView(tx, {
        level: "platform",
        userId: identity.userId,
        platformRole,
      }),
      current: await effectiveTemplate(tx, templatesActor, eventType, locale),
      versions: await templateVersions(tx, templatesActor, eventType, locale),
    }),
  );
  const t = await getTranslations("eventRules.settings");
  return (
    <>
      <ModulePageHeader
        title={t("title")}
        description={t("description.platform")}
        icon={<BellRing className="h-5 w-5" />}
      />
      <NotificationRulesCard
        data={data}
        action={savePlatformNotificationRulesAction}
      />
      <NotificationScheduleCard
        data={data}
        action={savePlatformNotificationScheduleAction}
      />
      <WhatsappTemplatesCard
        base={BASE}
        eventType={eventType}
        locale={locale}
        current={current}
        versions={versions}
        canEdit={canEditTemplates(templatesActor)}
        action={savePlatformWhatsappTemplateAction}
      />
    </>
  );
}
