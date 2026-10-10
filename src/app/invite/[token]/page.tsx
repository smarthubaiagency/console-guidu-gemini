import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { readIdentity } from "@/core/auth/identity";
import { getRequestBrand } from "@/core/brand/resolve";
import { getInvitationDetails } from "@/core/organizations/invitations";
import { prisma } from "@/lib/prisma/client";
import { AuthShell, ErrorNotice, SuccessNotice } from "@/shared/ui/auth-shell";
import { SignOutForm } from "@/shared/ui/sign-out-form";
import { InviteForm } from "./invite-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Convite de equipe",
};

function formatRoleName(role?: string): string {
  switch (role) {
    case "owner":
      return "Proprietário";
    case "admin":
      return "Administrador";
    case "editor":
      return "Editor";
    case "viewer":
      return "Visualizador";
    case "member":
    default:
      return "Membro";
  }
}

export default async function InviteTokenPage({
  params,
}: Readonly<{
  params: Promise<{ token: string }>;
}>) {
  const brand = await getRequestBrand();
  const { token } = await params;
  const identity = await readIdentity();

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
        title="Convite inválido"
        description="O link de convite acessado é inválido ou não foi encontrado."
        appName={brand.name}
        logoUrl={brand.logoUrl}
        footer={
          <Link href="/app" className="underline text-14">
            Ir para o painel
          </Link>
        }
      >
        <ErrorNotice testId="invite-not-found">
          Convite não encontrado ou inválido.
        </ErrorNotice>
      </AuthShell>
    );
  }

  if (details.status === "expired") {
    return (
      <AuthShell
        title="Convite expirado"
        description="Este convite expirou e não pode mais ser utilizado."
        appName={brand.name}
        logoUrl={brand.logoUrl}
        footer={
          <Link href="/app" className="underline text-14">
            Ir para o painel
          </Link>
        }
      >
        <ErrorNotice testId="invite-expired">
          Este convite expirou. Peça ao administrador para enviar um novo convite.
        </ErrorNotice>
      </AuthShell>
    );
  }

  if (details.status === "revoked") {
    return (
      <AuthShell
        title="Convite revogado"
        description="Este convite foi cancelado por um administrador."
        appName={brand.name}
        logoUrl={brand.logoUrl}
        footer={
          <Link href="/app" className="underline text-14">
            Ir para o painel
          </Link>
        }
      >
        <ErrorNotice testId="invite-revoked">
          Este convite foi revogado por um administrador.
        </ErrorNotice>
      </AuthShell>
    );
  }

  if (details.status === "already_accepted") {
    return (
      <AuthShell
        title="Convite já aceito"
        description="Este convite já foi utilizado anteriormente."
        appName={brand.name}
        logoUrl={brand.logoUrl}
        footer={
          <Link href="/app" className="underline text-14">
            Ir para o painel
          </Link>
        }
      >
        <SuccessNotice testId="invite-accepted">
          Você já aceitou este convite.
        </SuccessNotice>
      </AuthShell>
    );
  }

  if (details.status === "recipient_mismatch") {
    return (
      <AuthShell
        title="Destinatário diferente"
        description="Você está conectado com uma conta diferente daquela para a qual o convite foi enviado."
        appName={brand.name}
        logoUrl={brand.logoUrl}
        footer={
          <div className="flex items-center gap-4 text-14">
            <Link href="/app" className="underline">
              Ir para o painel
            </Link>
            <SignOutForm />
          </div>
        }
      >
        <div className="space-y-4">
          <ErrorNotice testId="invite-mismatch">
            Este convite foi enviado para outro e-mail.
          </ErrorNotice>
          <p className="text-12 text-text-secondary">
            Você está conectado como{" "}
            <span className="font-medium text-text">{identity.email}</span>. Para
            aceitar este convite, saia desta conta e entre com o e-mail convidado.
          </p>
        </div>
      </AuthShell>
    );
  }

  if (details.status === "email_unconfirmed") {
    return (
      <AuthShell
        title="E-mail não confirmado"
        description="Confirmação de e-mail obrigatória."
        appName={brand.name}
        logoUrl={brand.logoUrl}
        footer={
          <div className="flex items-center gap-4 text-14">
            <Link href="/app" className="underline">
              Ir para o painel
            </Link>
            <SignOutForm />
          </div>
        }
      >
        <ErrorNotice testId="invite-unconfirmed">
          O seu e-mail precisa estar confirmado para aceitar o convite.
        </ErrorNotice>
      </AuthShell>
    );
  }

  // Estado Válido: Apresenta organização, workspace, papel e botão de aceite
  return (
    <AuthShell
      title="Convite de equipe"
      description="Você foi convidado para participar de uma organização."
      appName={brand.name}
      logoUrl={brand.logoUrl}
      footer={
        <div className="flex items-center justify-between text-12 text-text-tertiary">
          <span>
            Conectado como <span className="text-text font-medium">{identity.email}</span>
          </span>
          <SignOutForm />
        </div>
      }
    >
      <div className="space-y-6">
        <div className="border border-card-border bg-surface-card rounded-xl p-5 shadow-xs space-y-3">
          <div>
            <span className="text-11 text-text-tertiary uppercase tracking-wider font-semibold">
              Organização
            </span>
            <p className="text-16 font-semibold text-text">
              {details.organizationName}
            </p>
          </div>

          {details.workspaceName && (
            <div>
              <span className="text-11 text-text-tertiary uppercase tracking-wider font-semibold">
                Workspace
              </span>
              <p className="text-14 font-medium text-text">
                {details.workspaceName}
              </p>
            </div>
          )}

          <div>
            <span className="text-11 text-text-tertiary uppercase tracking-wider font-semibold">
              Papel atribuído
            </span>
            <p className="text-14 font-medium text-text">
              {formatRoleName(details.role)}
            </p>
          </div>
        </div>

        <InviteForm rawToken={token} />
      </div>
    </AuthShell>
  );
}
