import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, Layers, ArrowRight, ShieldCheck } from "lucide-react";
import { requireUserPage } from "@/core/auth/page-guard";
import { requireLegalAcceptance } from "@/core/legal/gate";
import { prisma } from "@/lib/prisma/client";
import { listRequestUserWorkspaces } from "@/core/partners/request-context";
import { SignOutForm } from "@/shared/ui/sign-out-form";
import { getRequestBrand } from "@/core/brand/resolve";
import { BrandMark } from "@/shared/ui/brand-mark";
import { ActionForm } from "@/components/partners/action-form";
import { cancelWorkspaceDeletionAction } from "@/core/privacy/actions";
import { listScheduledDeletions } from "@/core/privacy/deletion";
import { getRequestPartner } from "@/core/partners/resolve";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export const metadata: Metadata = { title: "Seus Workspaces" };

/**
 * Landing router for an authenticated identity at `/app`.
 *
 * Implements Specification Section 11:
 * - Exactly one workspace: immediately redirects to `/app/[workspaceSlug]`.
 * - Multiple workspaces: presents explicit workspace selection cards.
 * - Zero workspaces: displays a clean, honest empty state with contact advice.
 */
export default async function AppPage() {
  const brand = await getRequestBrand();
  const identity = await requireUserPage("/app");
  await requireLegalAcceptance(identity, "/app");
  const workspaces = await listRequestUserWorkspaces(prisma, identity.userId);
  // Deletions this owner may still cancel (F3e); they keep the page here.
  const partner = await getRequestPartner();
  const scheduled = await withIdentityContext(
    prisma,
    identity.userId,
    (tx) => listScheduledDeletions(tx),
    { partnerId: partner?.partnerId ?? null },
  );

  // If the user has access to exactly one workspace, direct redirect
  const singleWorkspace = workspaces[0];
  if (workspaces.length === 1 && singleWorkspace && scheduled.length === 0) {
    redirect(`/app/${singleWorkspace.workspaceSlug}`);
  }

  return (
    <div className="bg-surface-raised flex min-h-screen flex-col justify-between">
      <header className="border-border bg-surface-card flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <BrandMark name={brand.name} logoUrl={brand.logoUrl} size="md" />
          <span className="text-text font-bold tracking-tight">{brand.name}</span>
        </div>

        <div className="flex items-center gap-3">
          <span
            className="text-12 text-text-secondary hidden font-medium sm:inline"
            data-testid="identity-email"
          >
            {identity.email}
          </span>
          <Link
            href="/app/account/security"
            className="text-12 text-text-subtle hover:text-text border-border flex items-center gap-1.5 rounded-lg border px-3 py-1.5"
          >
            <ShieldCheck className="text-success-solid h-3.5 w-3.5" />
            <span>Segurança da Conta</span>
          </Link>
          <SignOutForm />
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
        <div className="mb-8 text-center">
          <h1 className="text-24 text-text font-bold tracking-tight">
            Selecione seu Workspace
          </h1>
          <p className="text-14 text-text-secondary mt-1">
            Escolha o ambiente de trabalho que deseja acessar para iniciar.
          </p>
        </div>

        {scheduled.length > 0 ? (
          <section
            className="border-warning-border bg-warning-bg mb-6 space-y-3 rounded-xl border p-4"
            data-testid="scheduled-deletions"
          >
            <h2 className="text-14 text-warning-text font-semibold">
              Exclusões agendadas
            </h2>
            <ul className="space-y-3">
              {scheduled.map((d) => (
                <li
                  key={d.workspaceId}
                  className="text-12 text-warning-text flex flex-wrap items-center justify-between gap-3"
                >
                  <span>
                    <span className="font-semibold">{d.workspaceName}</span> ·
                    bloqueado; os dados serão apagados em{" "}
                    {d.purgeAfter.toLocaleDateString("pt-BR", {
                      timeZone: "America/Sao_Paulo",
                    })}
                  </span>
                  <ActionForm
                    action={cancelWorkspaceDeletionAction}
                    submitLabel="Cancelar exclusão"
                    tone="neutral"
                    testId={`cancel-deletion-${d.workspaceSlug}`}
                  >
                    <input
                      type="hidden"
                      name="workspaceId"
                      value={d.workspaceId}
                    />
                  </ActionForm>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {workspaces.length === 0 ? (
          <div className="border-card-border bg-surface-card rounded-2xl border p-8 text-center shadow-xs">
            <div className="bg-surface-hover text-text-tertiary mx-auto flex h-12 w-12 items-center justify-center rounded-xl">
              <Layers className="h-6 w-6" />
            </div>
            <h2 className="text-16 text-text mt-4 font-semibold">
              Nenhum workspace atribuído
            </h2>
            <p className="text-12 text-text-secondary mx-auto mt-2 max-w-sm leading-relaxed">
              Sua conta está ativa, mas você ainda não foi adicionado a nenhum
              workspace da sua organização. Solicite um convite ao seu
              administrador.
            </p>
            <div className="mt-6">
              <Link
                href="/app/account/security"
                className="text-12 text-text hover:text-text-subtle font-semibold underline"
              >
                Gerenciar segurança e MFA da sua conta
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {workspaces.map((ws) => (
              <Link
                key={ws.workspaceId}
                href={`/app/${ws.workspaceSlug}`}
                className="group border-card-border bg-surface-card hover:border-border-strong flex items-center justify-between rounded-xl border p-4 shadow-xs transition hover:shadow-sm"
              >
                <div className="flex items-center gap-3.5">
                  <div className="bg-surface-hover text-text-subtle group-hover:bg-primary group-hover:text-on-primary flex h-10 w-10 items-center justify-center rounded-lg transition">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-14 text-text font-semibold">
                      {ws.workspaceName}
                    </h3>
                    <p className="text-12 text-text-secondary">
                      {ws.organizationName} • Papel:{" "}
                      <span className="text-text-subtle font-medium capitalize">
                        {ws.workspaceRole}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="text-12 text-text-secondary group-hover:text-text flex items-center gap-1 font-semibold transition">
                  <span>Acessar</span>
                  <ArrowRight className="h-4 w-4" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>

      <footer className="border-border bg-surface-card text-12 text-text-tertiary border-t py-4 text-center">
        {brand.name} Plataforma SaaS Modular • Isolamento Multiempresa RLS
      </footer>
    </div>
  );
}
