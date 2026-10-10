import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

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
export const metadata: Metadata = { title: "Convite de parceiro" };

const MESSAGES: Record<string, string> = {
  not_found: "Convite não encontrado ou inválido.",
  accepted: "Este convite já foi aceito.",
  revoked: "Este convite foi revogado.",
  expired: "Este convite expirou. Peça um novo convite.",
  recipient_mismatch:
    "Este convite foi enviado para outro e-mail. Entre com a conta convidada.",
  email_unconfirmed:
    "O seu e-mail precisa estar confirmado para aceitar o convite.",
};

/** Accepts an invitation to join a partner (ADR 0012, P4a). */
export default async function PartnerInvitePage({
  params,
}: Readonly<{ params: Promise<{ token: string }> }>) {
  const brand = await getRequestBrand();
  const { token } = await params;
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
        title="Convite indisponível"
        appName={brand.name}
        logoUrl={brand.logoUrl}
        footer={<SignOutForm />}
      >
        <ErrorNotice testId="partner-invite-error">
          {MESSAGES[view.status]}
        </ErrorNotice>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={`Entrar em ${view.partnerName}`}
      description={`Você foi convidado como ${partnerRoleLabel(view.role)}. Depois de aceitar, use o console do parceiro em /admin no domínio do parceiro.`}
      appName={brand.name}
      logoUrl={brand.logoUrl}
      footer={<Link href="/app">Voltar</Link>}
    >
      <ActionForm
        action={acceptPartnerInvitationAction}
        submitLabel="Aceitar convite"
        testId="accept-partner-invite"
      >
        <input type="hidden" name="token" value={token} />
      </ActionForm>
    </AuthShell>
  );
}
