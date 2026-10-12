import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { LegalEditor } from "@/components/legal/legal-editor";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import {
  deletePlatformLegalTranslationAction,
  publishPlatformLegalAction,
  savePlatformLegalTranslationAction,
  translatePlatformLegalAction,
} from "@/core/legal/actions";
import { machineTranslationConfigured } from "@/core/i18n/machine/provider";
import { latestLegalTranslationRuns } from "@/core/legal/machine";
import {
  legalTranslationLanguages,
  listLegalDocuments,
  listPartnerLegalTranslations,
} from "@/core/legal/service";
import { platformGrants } from "@/core/module-runtime/loaders";
import { getRequestPartner } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal.platform");
  return { title: t("metaTitle") };
}

/** Terms and privacy of the house partner (ADR 0012, P4b2). */
export default async function PlatformLegalPage() {
  const identity = await requirePlatformAdminPage("/platform/legal");
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  if (!platformGrants(admin?.role ?? null)("platform.legal.manage")) {
    return <ModuleNotice variant="denied" />;
  }
  const partner = await getRequestPartner();
  const { documents, languages, translations, runs } = partner
    ? await withIdentityContext(
        prisma,
        identity.userId,
        async (tx) => ({
          documents: await listLegalDocuments(tx, partner.partnerId),
          languages: await legalTranslationLanguages(tx),
          translations: await listPartnerLegalTranslations(
            tx,
            partner.partnerId,
          ),
          runs: await latestLegalTranslationRuns(tx, partner.partnerId),
        }),
        { partnerId: partner.partnerId },
      )
    : { documents: [], languages: [], translations: [], runs: {} };
  const t = await getTranslations("legal.platform");
  const tPlatform = await getTranslations("platform");
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <ModulePageHeader
        trail={[tPlatform("breadcrumb"), t("breadcrumb")]}
        title={t("title")}
        description={t("description")}
        icon={<FileText className="h-5 w-5" />}
      />
      <LegalEditor
        documents={documents}
        action={publishPlatformLegalAction}
        languages={languages}
        translations={translations}
        translationActions={{
          save: savePlatformLegalTranslationAction,
          remove: deletePlatformLegalTranslationAction,
          machine: {
            action: translatePlatformLegalAction,
            configured: machineTranslationConfigured(),
            runs,
          },
        }}
      />
    </div>
  );
}
