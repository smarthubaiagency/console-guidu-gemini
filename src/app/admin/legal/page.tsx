import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { LegalEditor } from "@/components/legal/legal-editor";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import {
  deletePartnerLegalTranslationAction,
  publishPartnerLegalAction,
  savePartnerLegalTranslationAction,
} from "@/core/legal/actions";
import {
  legalTranslationLanguages,
  listLegalDocuments,
  listPartnerLegalTranslations,
} from "@/core/legal/service";
import { partnerGrants } from "@/core/module-runtime/loaders";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("partnerConsole");
  return { title: t("legal.metaTitle") };
}

export default async function PartnerLegalPage() {
  const { identity, partner, membership } =
    await requirePartnerConsolePage("/admin/legal");
  if (!partnerGrants(membership.role)("partner.legal.manage")) {
    return <ModuleNotice variant="denied" />;
  }
  const { documents, languages, translations } = await withIdentityContext(
    prisma,
    identity.userId,
    async (tx) => ({
      documents: await listLegalDocuments(tx, partner.partnerId),
      languages: await legalTranslationLanguages(tx),
      translations: await listPartnerLegalTranslations(tx, partner.partnerId),
    }),
    { partnerId: partner.partnerId },
  );
  const t = await getTranslations("partnerConsole");
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <ModulePageHeader
        trail={[t("breadcrumb"), t("legal.title")]}
        title={t("legal.title")}
        description={t("legal.description")}
        icon={<FileText className="h-5 w-5" />}
      />
      <LegalEditor
        documents={documents}
        action={publishPartnerLegalAction}
        languages={languages}
        translations={translations}
        translationActions={{
          save: savePartnerLegalTranslationAction,
          remove: deletePartnerLegalTranslationAction,
        }}
      />
    </div>
  );
}
