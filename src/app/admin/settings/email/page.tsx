import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { EmailSettings } from "@/components/email/email-settings";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { getRequestBrand } from "@/core/brand/resolve";
import { sendPartnerTestEmailAction } from "@/core/email/actions";
import { emailConfig } from "@/core/notifications/transport";
import { savePartnerSettingsAction } from "@/core/settings/actions";
import { settingsView } from "@/core/settings/service";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export const metadata: Metadata = { title: "E-mail (Admin)" };

/**
 * Admin › Configurações › E-mail (CF3a): the sender of the e-mails the
 * partner's customers receive, over the platform's default.
 */
export default async function PartnerEmailSettingsPage() {
  const { identity, partner, membership } = await requirePartnerConsolePage(
    "/admin/settings/email",
  );
  const view = await withIdentityContext(
    prisma,
    identity.userId,
    (tx) =>
      settingsView(tx, {
        level: "partner",
        userId: identity.userId,
        partnerId: partner.partnerId,
        partnerRole: membership.role,
      }),
    { partnerId: partner.partnerId },
  );
  const brand = await getRequestBrand();
  const t = await getTranslations("email");

  return (
    <>
      <ModulePageHeader
        title={t("title")}
        description={t("description.partner")}
        icon={<Mail className="h-5 w-5" />}
      />
      <EmailSettings
        view={view}
        saveAction={savePartnerSettingsAction}
        testAction={sendPartnerTestEmailAction}
        brand={brand}
        fromAddress={emailConfig()?.fromAddress ?? null}
        canTest={view.canEdit}
      />
    </>
  );
}
