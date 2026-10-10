import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AcceptLegalForm } from "@/components/legal/accept-form";
import { requireUserPage } from "@/core/auth/page-guard";
import { safeInternalPath } from "@/core/auth/redirects";
import { getRequestBrand } from "@/core/brand/resolve";
import { LEGAL_KIND_LABELS, pendingLegalDocuments } from "@/core/legal/service";
import { getRequestPartner } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AuthShell } from "@/shared/ui/auth-shell";
import { SignOutForm } from "@/shared/ui/sign-out-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Aceite dos termos" };

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

  const pending = await withIdentityContext(
    prisma,
    identity.userId,
    (tx) => pendingLegalDocuments(tx, partner.partnerId, identity.userId),
    { partnerId: partner.partnerId },
  );
  if (pending.length === 0) redirect(next);

  return (
    <AuthShell
      title="Antes de continuar"
      description={`Para usar ${brand.name}, aceite os documentos abaixo.`}
      appName={brand.name}
      logoUrl={brand.logoUrl}
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
              {LEGAL_KIND_LABELS[document.kind]} · versão {document.version} ·{" "}
              <Link
                href={`/legal/${document.kind}`}
                target="_blank"
                className="underline"
              >
                abrir em nova aba
              </Link>
            </p>
            <div className="text-12 text-text-subtle mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap">
              {document.body}
            </div>
          </section>
        ))}
        <AcceptLegalForm next={next} />
      </div>
    </AuthShell>
  );
}
