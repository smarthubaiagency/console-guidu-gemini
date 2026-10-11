import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { getRequestBrand } from "@/core/brand/resolve";
import {
  LEGAL_KINDS,
  latestLegalDocument,
  type LegalKind,
} from "@/core/legal/service";
import { getRequestPartner } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";
import { withPartnerContext } from "@/lib/prisma/with-partner-context";
import { AuthShell } from "@/shared/ui/auth-shell";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal");
  return { title: t("document.metadataTitle") };
}

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
  const t = await getTranslations("legal");
  const format = await getFormatter();

  return (
    <AuthShell
      title={document.title}
      description={t("document.meta", {
        kind: t(`kinds.${document.kind}`),
        version: document.version,
        date: format.dateTime(document.publishedAt, {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        }),
      })}
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
