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
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import {
  savePartnerNotificationRulesAction,
  savePartnerNotificationScheduleAction,
  savePartnerWhatsappTemplateAction,
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

const BASE = "/admin/settings/notifications";

/**
 * Admin › Configurações › Notificações (H2): the partner adjusts the rules
 * for its customers (and may lock), the quiet window, the digest time and
 * its own WhatsApp texts.
 */
export default async function PartnerNotificationSettingsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ template?: string; locale?: string }>;
}>) {
  const { identity, partner, membership } =
    await requirePartnerConsolePage(BASE);
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
    level: "partner",
    userId: identity.userId,
    partnerId: partner.partnerId,
    partnerRole: membership.role,
  };
  const { data, current, versions } = await withIdentityContext(
    prisma,
    identity.userId,
    async (tx) => ({
      data: await notificationSettingsView(tx, {
        level: "partner",
        userId: identity.userId,
        partnerId: partner.partnerId,
        partnerRole: membership.role,
      }),
      current: await effectiveTemplate(tx, templatesActor, eventType, locale),
      versions: await templateVersions(tx, templatesActor, eventType, locale),
    }),
    { partnerId: partner.partnerId },
  );
  const t = await getTranslations("eventRules.settings");
  return (
    <>
      <ModulePageHeader
        title={t("title")}
        description={t("description.partner")}
        icon={<BellRing className="h-5 w-5" />}
      />
      <NotificationRulesCard
        data={data}
        action={savePartnerNotificationRulesAction}
      />
      <NotificationScheduleCard
        data={data}
        action={savePartnerNotificationScheduleAction}
      />
      <WhatsappTemplatesCard
        base={BASE}
        eventType={eventType}
        locale={locale}
        current={current}
        versions={versions}
        canEdit={canEditTemplates(templatesActor)}
        action={savePartnerWhatsappTemplateAction}
      />
    </>
  );
}
