import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { ActionForm } from "@/components/partners/action-form";
import { partnerRoleLabel } from "@/components/partners/role-label";
import { readIdentity } from "@/core/auth/identity";
import { getRequestBrand } from "@/core/brand/resolve";
import { acceptPartnerInvitationAction } from "@/core/partners/actions";
import { getPartnerInvitationView } from "@/core/partners/invitations";
import { prisma } from "@/lib/prisma/client";
import { AuthShell, ErrorNotice } from "@/shared/ui/auth-shell";
import { SignOutForm } from "@/shared/ui/sign-out-form";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("invite");
  return { title: t("partner.metadataTitle") };
}

/** Key (in `invite.partner.status`) of each unavailable state. */
const MESSAGES: Record<string, string> = {
  not_found: "notFound",
  accepted: "accepted",
  revoked: "revoked",
  expired: "expired",
  recipient_mismatch: "recipientMismatch",
  email_unconfirmed: "emailUnconfirmed",
};

/** Accepts an invitation to join a partner (ADR 0012, P4a). */
export default async function PartnerInvitePage({
  params,
}: Readonly<{ params: Promise<{ token: string }> }>) {
  const brand = await getRequestBrand();
  const { token } = await params;
  const t = await getTranslations("invite.partner");
  const identity = await readIdentity();
  if (!identity) {
    redirect(`/login?next=${encodeURIComponent(`/partner-invite/${token}`)}`);
  }

  const view = /^[0-9a-f]{64}$/.test(token)
    ? await getPartnerInvitationView(prisma, identity, token)
    : ({ status: "not_found" } as const);

  if (view.status !== "valid") {
    return (
      <AuthShell
        title={t("unavailableTitle")}
        appName={brand.name}
        logoUrl={brand.logoUrl}
        footer={<SignOutForm />}
      >
        <ErrorNotice testId="partner-invite-error">
          {t(`status.${MESSAGES[view.status] ?? "notFound"}`)}
        </ErrorNotice>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t("title", { partner: view.partnerName })}
      description={t("description", { role: partnerRoleLabel(view.role) })}
      appName={brand.name}
      logoUrl={brand.logoUrl}
      footer={<Link href="/app">{t("back")}</Link>}
    >
      <ActionForm
        action={acceptPartnerInvitationAction}
        submitLabel={t("accept")}
        testId="accept-partner-invite"
      >
        <input type="hidden" name="token" value={token} />
      </ActionForm>
    </AuthShell>
  );
}
