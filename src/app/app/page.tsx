import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, Layers, ArrowRight, ShieldCheck } from "lucide-react";
import { requireUserPage } from "@/core/auth/page-guard";
import { prisma } from "@/lib/prisma/client";
import { listUserWorkspaces } from "@/core/workspaces/navigation";
import { SignOutForm } from "@/shared/ui/sign-out-form";

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
  const identity = await requireUserPage("/app");
  const workspaces = await listUserWorkspaces(prisma, identity.userId);

  // If the user has access to exactly one workspace, direct redirect
  const singleWorkspace = workspaces[0];
  if (workspaces.length === 1 && singleWorkspace) {
    redirect(`/app/${singleWorkspace.workspaceSlug}`);
  }

  return (
    <div className="bg-surface-raised flex min-h-screen flex-col justify-between">
      <header className="border-border bg-surface-card flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="bg-primary text-on-primary text-14 flex h-7 w-7 items-center justify-center rounded-lg font-bold">
            G
          </div>
          <span className="text-text font-bold tracking-tight">GUIDU</span>
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
        GUIDU Plataforma SaaS Modular • Isolamento Multiempresa RLS
      </footer>
    </div>
  );
}
