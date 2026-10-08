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
    <div className="min-h-screen bg-neutral-50 flex flex-col justify-between">
      <header className="border-b border-neutral-200 bg-white px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-7 w-7 rounded-lg bg-neutral-900 text-white flex items-center justify-center font-bold text-sm">
            G
          </div>
          <span className="font-bold text-neutral-900 tracking-tight">GUIDU</span>
        </div>

        <div className="flex items-center gap-3">
          <span
            className="hidden sm:inline text-xs text-neutral-500 font-medium"
            data-testid="identity-email"
          >
            {identity.email}
          </span>
          <Link
            href="/app/account/security"
            className="flex items-center gap-1.5 text-xs text-neutral-600 hover:text-neutral-900 border border-neutral-200 px-3 py-1.5 rounded-lg"
          >
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            <span>Segurança da Conta</span>
          </Link>
          <SignOutForm />
        </div>
      </header>

      <main className="max-w-2xl mx-auto w-full px-6 py-12 flex-1">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
            Selecione seu Workspace
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Escolha o ambiente de trabalho que deseja acessar para iniciar.
          </p>
        </div>

        {workspaces.length === 0 ? (
          <div className="rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-xs">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-100 text-neutral-400">
              <Layers className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-base font-semibold text-neutral-900">
              Nenhum workspace atribuído
            </h2>
            <p className="mt-2 text-xs text-neutral-500 max-w-sm mx-auto leading-relaxed">
              Sua conta está ativa, mas você ainda não foi adicionado a nenhum workspace da sua organização. Solicite um convite ao seu administrador.
            </p>
            <div className="mt-6">
              <Link
                href="/app/account/security"
                className="text-xs font-semibold text-neutral-900 underline hover:text-neutral-700"
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
                className="group flex items-center justify-between rounded-xl border border-neutral-200 bg-white p-4 shadow-xs hover:border-neutral-400 hover:shadow-md transition"
              >
                <div className="flex items-center gap-3.5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-100 text-neutral-700 group-hover:bg-neutral-900 group-hover:text-white transition">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm text-neutral-900">
                      {ws.workspaceName}
                    </h3>
                    <p className="text-xs text-neutral-500">
                      {ws.organizationName} • Papel:{" "}
                      <span className="capitalize font-medium text-neutral-700">
                        {ws.workspaceRole}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1 text-xs font-semibold text-neutral-500 group-hover:text-neutral-900 transition">
                  <span>Acessar</span>
                  <ArrowRight className="h-4 w-4" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>

      <footer className="border-t border-neutral-200 bg-white py-4 text-center text-xs text-neutral-400">
        GUIDU Plataforma SaaS Modular • Isolamento Multiempresa RLS
      </footer>
    </div>
  );
}
