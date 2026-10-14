import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { EmailSettings } from "@/components/email/email-settings";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { getRequestBrand } from "@/core/brand/resolve";
import { sendPlatformTestEmailAction } from "@/core/email/actions";
import { emailConfig } from "@/core/notifications/transport";
import { savePlatformSettingsAction } from "@/core/settings/actions";
import { settingsView } from "@/core/settings/service";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export const metadata: Metadata = { title: "E-mail (Plataforma)" };

/**
 * Plataforma › Configurações › E-mail (CF3a): the provider, the default
 * sender every partner inherits and a test e-mail.
 */
export default async function PlatformEmailSettingsPage() {
  const identity = await requirePlatformAdminPage("/platform/settings/email");
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  const view = await withIdentityContext(prisma, identity.userId, (tx) =>
    settingsView(tx, {
      level: "platform",
      userId: identity.userId,
      platformRole: admin?.status === "active" ? admin.role : null,
    }),
  );
  const brand = await getRequestBrand();
  const t = await getTranslations("email");

  return (
    <>
      <ModulePageHeader
        title={t("title")}
        description={t("description.platform")}
        icon={<Mail className="h-5 w-5" />}
      />
      <EmailSettings
        view={view}
        saveAction={savePlatformSettingsAction}
        testAction={sendPlatformTestEmailAction}
        brand={brand}
        fromAddress={emailConfig()?.fromAddress ?? null}
        canTest={view.canEdit}
      />
    </>
  );
}
