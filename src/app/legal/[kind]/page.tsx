import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";

import { getRequestBrand } from "@/core/brand/resolve";
import {
  LEGAL_KINDS,
  latestLocalizedLegalDocument,
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

/**
 * Latest terms or privacy policy of the host's partner (public, P4b2), in
 * the request language when translated (I5); `?original=1` shows the
 * original, which prevails.
 */
export default async function LegalDocumentPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ kind: string }>;
  searchParams: Promise<{ original?: string }>;
}>) {
  const { kind } = await params;
  const { original } = await searchParams;
  const showOriginal = original === "1";
  if (!(LEGAL_KINDS as readonly string[]).includes(kind)) notFound();
  const partner = await getRequestPartner();
  if (!partner) notFound();
  const brand = await getRequestBrand();

  const locale = await getLocale();
  const document = await withPartnerContext(prisma, partner.partnerId, (tx) =>
    latestLocalizedLegalDocument(
      tx,
      partner.partnerId,
      kind as LegalKind,
      // The original is never "translated" into its own language.
      showOriginal ? "" : locale,
    ),
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
      {document.translated ? (
        <p
          className="text-12 text-text-secondary mb-3"
          data-testid="legal-translation-note"
        >
          {t("document.translatedNote")}{" "}
          <Link
            href={`/legal/${document.kind}?original=1`}
            className="underline"
          >
            {t("document.showOriginal")}
          </Link>
        </p>
      ) : null}
      {showOriginal && document.locale !== locale ? (
        <p className="text-12 text-text-secondary mb-3">
          <Link href={`/legal/${document.kind}`} className="underline">
            {t("document.showTranslation")}
          </Link>
        </p>
      ) : null}
      <article
        lang={document.shownLocale}
        className="text-14 text-text whitespace-pre-wrap"
        data-testid="legal-document-body"
      >
        {document.body}
      </article>
    </AuthShell>
  );
}
