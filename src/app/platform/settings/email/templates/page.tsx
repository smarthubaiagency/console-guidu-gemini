import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

import { EmailTemplates } from "@/components/email/email-templates";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { appConfig } from "@/core/config/app";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { getRequestBrand } from "@/core/brand/resolve";
import {
  restorePlatformEmailTemplateAction,
  savePlatformEmailTemplateAction,
} from "@/core/email/template-actions";
import {
  canManageEmailTemplates,
  loadEmailTemplates,
  type EmailTemplateActor,
} from "@/core/email/templates";
import { getRequestOrigin } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export const metadata: Metadata = { title: "Modelos de e-mail (Plataforma)" };

const PATH = "/platform/settings/email/templates";

/**
 * Plataforma › Configurações › Modelos de e-mail (CF3b): the base subject
 * and body of each event and language, over the code's templates.
 */
export default async function PlatformEmailTemplatesPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ event?: string; locale?: string }> }>) {
  const identity = await requirePlatformAdminPage(PATH);
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  const actor: EmailTemplateActor = {
    level: "platform",
    userId: identity.userId,
    platformRole: admin?.status === "active" ? admin.role : null,
  };
  const { event, locale } = await searchParams;
  const data = await withIdentityContext(prisma, identity.userId, (tx) =>
    loadEmailTemplates(tx, actor, event),
  );
  const brand = await getRequestBrand();
  const t = await getTranslations("email.templates");

  return (
    <>
      <ModulePageHeader
        title={t("title")}
        description={t("description.platform")}
        icon={<Mail className="h-5 w-5" />}
      />
      <EmailTemplates
        data={data}
        level="platform"
        canEdit={canManageEmailTemplates(actor)}
        initialLocale={locale ?? (await getLocale())}
        basePath={PATH}
        brand={{
          name: brand.name,
          supportEmail: brand.supportEmail,
          supportUrl: brand.supportUrl,
          color: brand.primaryColor,
        }}
        origin={(await getRequestOrigin()) ?? appConfig.url}
        saveAction={savePlatformEmailTemplateAction}
        restoreAction={restorePlatformEmailTemplateAction}
      />
    </>
  );
}
