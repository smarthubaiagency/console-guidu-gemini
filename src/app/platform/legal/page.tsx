import type { Metadata } from "next";
import { FileText } from "lucide-react";

import { LegalEditor } from "@/components/legal/legal-editor";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { publishPlatformLegalAction } from "@/core/legal/actions";
import { listLegalDocuments } from "@/core/legal/service";
import { platformGrants } from "@/core/module-runtime/loaders";
import { getRequestPartner } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export const metadata: Metadata = { title: "Termos e privacidade (Admin)" };

/** Terms and privacy of the house partner (ADR 0012, P4b2). */
export default async function PlatformLegalPage() {
  const identity = await requirePlatformAdminPage("/platform/legal");
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  if (!platformGrants(admin?.role ?? null)("platform.legal.manage")) {
    return <ModuleNotice variant="denied" />;
  }
  const partner = await getRequestPartner();
  const documents = partner
    ? await withIdentityContext(
        prisma,
        identity.userId,
        (tx) => listLegalDocuments(tx, partner.partnerId),
        { partnerId: partner.partnerId },
      )
    : [];
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <ModulePageHeader
        trail={["Administração", "Termos e privacidade"]}
        title="Termos e privacidade da plataforma"
        description="Valem para os clientes diretos, nos domínios da plataforma."
        icon={<FileText className="h-5 w-5" />}
      />
      <LegalEditor documents={documents} action={publishPlatformLegalAction} />
    </div>
  );
}
