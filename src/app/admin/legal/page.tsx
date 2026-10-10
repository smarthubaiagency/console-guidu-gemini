import type { Metadata } from "next";
import { FileText } from "lucide-react";

import { LegalEditor } from "@/components/legal/legal-editor";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { publishPartnerLegalAction } from "@/core/legal/actions";
import { listLegalDocuments } from "@/core/legal/service";
import { partnerGrants } from "@/core/module-runtime/loaders";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export const metadata: Metadata = { title: "Termos e privacidade (Parceiro)" };

export default async function PartnerLegalPage() {
  const { identity, partner, membership } =
    await requirePartnerConsolePage("/admin/legal");
  if (!partnerGrants(membership.role)("partner.legal.manage")) {
    return <ModuleNotice variant="denied" />;
  }
  const documents = await withIdentityContext(
    prisma,
    identity.userId,
    (tx) => listLegalDocuments(tx, partner.partnerId),
    { partnerId: partner.partnerId },
  );
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <ModulePageHeader
        trail={["Parceiro", "Termos e privacidade"]}
        title="Termos e privacidade"
        description="Seus clientes aceitam a versão vigente no primeiro acesso, e de novo quando você publicar uma mudança relevante."
        icon={<FileText className="h-5 w-5" />}
      />
      <LegalEditor documents={documents} action={publishPartnerLegalAction} />
    </div>
  );
}
