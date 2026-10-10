import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getRequestBrand } from "@/core/brand/resolve";
import {
  LEGAL_KIND_LABELS,
  LEGAL_KINDS,
  latestLegalDocument,
  type LegalKind,
} from "@/core/legal/service";
import { getRequestPartner } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";
import { withPartnerContext } from "@/lib/prisma/with-partner-context";
import { AuthShell } from "@/shared/ui/auth-shell";

export const metadata: Metadata = { title: "Documentos legais" };

/** Latest terms or privacy policy of the host's partner (public, P4b2). */
export default async function LegalDocumentPage({
  params,
}: Readonly<{ params: Promise<{ kind: string }> }>) {
  const { kind } = await params;
  if (!(LEGAL_KINDS as readonly string[]).includes(kind)) notFound();
  const partner = await getRequestPartner();
  if (!partner) notFound();
  const brand = await getRequestBrand();

  const document = await withPartnerContext(prisma, partner.partnerId, (tx) =>
    latestLegalDocument(tx, partner.partnerId, kind as LegalKind),
  );
  if (!document) notFound();

  return (
    <AuthShell
      title={document.title}
      description={`${LEGAL_KIND_LABELS[document.kind]} · versão ${document.version} · ${document.publishedAt.toLocaleDateString("pt-BR")}`}
      appName={brand.name}
      logoUrl={brand.logoUrl}
    >
      <article
        className="text-14 text-text whitespace-pre-wrap"
        data-testid="legal-document-body"
      >
        {document.body}
      </article>
    </AuthShell>
  );
}
