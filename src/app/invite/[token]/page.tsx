import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { readIdentity } from "@/core/auth/identity";
import { getRequestBrand } from "@/core/brand/resolve";
import { getInvitationDetails } from "@/core/organizations/invitations";
import { prisma } from "@/lib/prisma/client";
import { AuthShell, ErrorNotice, SuccessNotice } from "@/shared/ui/auth-shell";
import { SignOutForm } from "@/shared/ui/sign-out-form";
import { InviteForm } from "./invite-form";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("invite");
  return { title: t("team.metadataTitle") };
}

const ROLES = ["owner", "admin", "editor", "viewer", "member"] as const;

/** Key (in `invite.team.roles`) of a role; unknown roles read as member. */
function roleKey(role?: string): (typeof ROLES)[number] {
  return (ROLES as readonly string[]).includes(role ?? "")
    ? (role as (typeof ROLES)[number])
    : "member";
}

export default async function InviteTokenPage({
  params,
}: Readonly<{
  params: Promise<{ token: string }>;
}>) {
  const brand = await getRequestBrand();
  const { token } = await params;
  const identity = await readIdentity();
  const t = await getTranslations("invite.team");

  // 1. Sem sessão: redireciona para login preservando o next
  if (!identity) {
    redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  }

  // 2. Com sessão: obter detalhes do convite sob RLS
  const details = await getInvitationDetails(prisma, token, identity);

  // Estados explícitos de erro/encerramento
  if (details.status === "not_found") {
    return (
      <AuthShell
        title={t("notFound.title")}
        description={t("notFound.description")}
        appName={brand.name}
        logoUrl={brand.logoUrl}
        footer={
          <Link href="/app" className="text-14 underline">
            {t("goToDashboard")}
          </Link>
        }
      >
        <ErrorNotice testId="invite-not-found">
          {t("notFound.notice")}
        </ErrorNotice>
      </AuthShell>
    );
  }

  if (details.status === "expired") {
    return (
      <AuthShell
        title={t("expired.title")}
        description={t("expired.description")}
        appName={brand.name}
        logoUrl={brand.logoUrl}
        footer={
          <Link href="/app" className="text-14 underline">
            {t("goToDashboard")}
          </Link>
        }
      >
        <ErrorNotice testId="invite-expired">{t("expired.notice")}</ErrorNotice>
      </AuthShell>
    );
  }

  if (details.status === "revoked") {
    return (
      <AuthShell
        title={t("revoked.title")}
        description={t("revoked.description")}
        appName={brand.name}
        logoUrl={brand.logoUrl}
        footer={
          <Link href="/app" className="text-14 underline">
            {t("goToDashboard")}
          </Link>
        }
      >
        <ErrorNotice testId="invite-revoked">{t("revoked.notice")}</ErrorNotice>
      </AuthShell>
    );
  }

  if (details.status === "already_accepted") {
    return (
      <AuthShell
        title={t("accepted.title")}
        description={t("accepted.description")}
        appName={brand.name}
        logoUrl={brand.logoUrl}
        footer={
          <Link href="/app" className="text-14 underline">
            {t("goToDashboard")}
          </Link>
        }
      >
        <SuccessNotice testId="invite-accepted">
          {t("accepted.notice")}
        </SuccessNotice>
      </AuthShell>
    );
  }

  if (details.status === "recipient_mismatch") {
    return (
      <AuthShell
        title={t("mismatch.title")}
        description={t("mismatch.description")}
        appName={brand.name}
        logoUrl={brand.logoUrl}
        footer={
          <div className="text-14 flex items-center gap-4">
            <Link href="/app" className="underline">
              {t("goToDashboard")}
            </Link>
            <SignOutForm />
          </div>
        }
      >
        <div className="space-y-4">
          <ErrorNotice testId="invite-mismatch">
            {t("mismatch.notice")}
          </ErrorNotice>
          <p className="text-12 text-text-secondary">
            {t.rich("mismatch.hint", {
              email: identity.email ?? "",
              strong: (chunks) => (
                <span className="text-text font-medium">{chunks}</span>
              ),
            })}
          </p>
        </div>
      </AuthShell>
    );
  }

  if (details.status === "email_unconfirmed") {
    return (
      <AuthShell
        title={t("unconfirmed.title")}
        description={t("unconfirmed.description")}
        appName={brand.name}
        logoUrl={brand.logoUrl}
        footer={
          <div className="text-14 flex items-center gap-4">
            <Link href="/app" className="underline">
              {t("goToDashboard")}
            </Link>
            <SignOutForm />
          </div>
        }
      >
        <ErrorNotice testId="invite-unconfirmed">
          {t("unconfirmed.notice")}
        </ErrorNotice>
      </AuthShell>
    );
  }

  // Estado Válido: Apresenta organização, workspace, papel e botão de aceite
  return (
    <AuthShell
      title={t("valid.title")}
      description={t("valid.description")}
      appName={brand.name}
      logoUrl={brand.logoUrl}
      footer={
        <div className="text-12 text-text-tertiary flex items-center justify-between">
          <span>
            {t.rich("valid.signedInAs", {
              email: identity.email ?? "",
              strong: (chunks) => (
                <span className="text-text font-medium">{chunks}</span>
              ),
            })}
          </span>
          <SignOutForm />
        </div>
      }
    >
      <div className="space-y-6">
        <div className="border-card-border bg-surface-card space-y-3 rounded-xl border p-5 shadow-xs">
          <div>
            <span className="text-11 text-text-tertiary font-semibold tracking-wider uppercase">
              {t("valid.organization")}
            </span>
            <p className="text-16 text-text font-semibold">
              {details.organizationName}
            </p>
          </div>

          {details.workspaceName && (
            <div>
              <span className="text-11 text-text-tertiary font-semibold tracking-wider uppercase">
                {t("valid.workspace")}
              </span>
              <p className="text-14 text-text font-medium">
                {details.workspaceName}
              </p>
            </div>
          )}

          <div>
            <span className="text-11 text-text-tertiary font-semibold tracking-wider uppercase">
              {t("valid.role")}
            </span>
            <p className="text-14 text-text font-medium">
              {t(`roles.${roleKey(details.role)}`)}
            </p>
          </div>
        </div>

        <InviteForm rawToken={token} />
      </div>
    </AuthShell>
  );
}
