import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

import { EmailTemplates } from "@/components/email/email-templates";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { appConfig } from "@/core/config/app";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { getRequestBrand } from "@/core/brand/resolve";
import {
  restorePartnerEmailTemplateAction,
  savePartnerEmailTemplateAction,
} from "@/core/email/template-actions";
import {
  canManageEmailTemplates,
  loadEmailTemplates,
  type EmailTemplateActor,
} from "@/core/email/templates";
import { getRequestOrigin } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export const metadata: Metadata = { title: "Modelos de e-mail (Admin)" };

const PATH = "/admin/settings/email/templates";

/**
 * Admin › Configurações › Modelos de e-mail (CF3b): the partner's subject
 * and body for its customers, over the platform's base. Customers never
 * edit templates.
 */
export default async function PartnerEmailTemplatesPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ event?: string; locale?: string }> }>) {
  const { identity, partner, membership } =
    await requirePartnerConsolePage(PATH);
  const actor: EmailTemplateActor = {
    level: "partner",
    userId: identity.userId,
    partnerId: partner.partnerId,
    partnerRole: membership.role,
  };
  const { event, locale } = await searchParams;
  const data = await withIdentityContext(
    prisma,
    identity.userId,
    (tx) => loadEmailTemplates(tx, actor, event),
    { partnerId: partner.partnerId },
  );
  const brand = await getRequestBrand();
  const t = await getTranslations("email.templates");

  return (
    <>
      <ModulePageHeader
        title={t("title")}
        description={t("description.partner")}
        icon={<Mail className="h-5 w-5" />}
      />
      <EmailTemplates
        data={data}
        level="partner"
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
        saveAction={savePartnerEmailTemplateAction}
        restoreAction={restorePartnerEmailTemplateAction}
      />
    </>
  );
}
