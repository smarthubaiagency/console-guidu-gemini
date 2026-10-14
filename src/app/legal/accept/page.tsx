import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { AcceptLegalForm } from "@/components/legal/accept-form";
import { requireUserPage } from "@/core/auth/page-guard";
import { safeInternalPath } from "@/core/auth/redirects";
import { getRequestBrand } from "@/core/brand/resolve";
import {
  localizeLegalDocuments,
  pendingLegalDocuments,
} from "@/core/legal/service";
import { getRequestPartner } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AuthShell } from "@/shared/ui/auth-shell";
import { SignOutForm } from "@/shared/ui/sign-out-form";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal");
  return { title: t("accept.metadataTitle") };
}

/** Acceptance of the host partner's pending terms and privacy (P4b2). */
export default async function AcceptLegalPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ next?: string }> }>) {
  const { next: rawNext } = await searchParams;
  const next = safeInternalPath(rawNext);
  const identity = await requireUserPage(`/legal/accept`);
  const brand = await getRequestBrand();
  const partner = await getRequestPartner();
  if (!partner) redirect(next);

  const locale = await getLocale();
  // Shown in the request language when translated (I5); acceptance is of
  // the version, recomputed by the action.
  const pending = await withIdentityContext(
    prisma,
    identity.userId,
    async (tx) =>
      localizeLegalDocuments(
        tx,
        await pendingLegalDocuments(tx, partner.partnerId, identity.userId),
        locale,
      ),
    { partnerId: partner.partnerId },
  );
  if (pending.length === 0) redirect(next);
  const t = await getTranslations("legal");

  return (
    <AuthShell
      title={t("accept.title")}
      description={t("accept.description", { appName: brand.name })}
      brand={brand}
      footer={<SignOutForm />}
    >
      <div className="space-y-4">
        {pending.map((document) => (
          <section
            key={document.id}
            className="border-card-border bg-surface-card rounded-xl border p-4"
          >
            <h2 className="text-14 text-text font-semibold">
              {document.title}
            </h2>
            <p className="text-12 text-text-secondary">
              {t.rich("accept.meta", {
                kind: t(`kinds.${document.kind}`),
                version: document.version,
                link: (chunks) => (
                  <Link
                    href={`/legal/${document.kind}`}
                    target="_blank"
                    className="underline"
                  >
                    {chunks}
                  </Link>
                ),
              })}
            </p>
            {document.translated ? (
              <p
                className="text-12 text-text-secondary mt-1"
                data-testid="legal-translation-note"
              >
                {t("accept.translatedNote")}
              </p>
            ) : null}
            <div
              lang={document.shownLocale}
              className="text-12 text-text-subtle mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap"
            >
              {document.body}
            </div>
          </section>
        ))}
        <AcceptLegalForm next={next} />
      </div>
    </AuthShell>
  );
}
