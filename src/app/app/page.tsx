import type { Metadata } from "next";
import Link from "next/link";

import { requireUserPage } from "@/core/auth/page-guard";
import { SignOutForm } from "@/shared/ui/sign-out-form";

export const metadata: Metadata = { title: "Minha conta" };

/**
 * Landing page for a signed-in identity.
 *
 * Workspace selection and the dashboard belong to F1.2/F1.5; until they land
 * this page states that plainly instead of showing invented numbers
 * (specification section 11).
 */
export default async function AppPage() {
  const identity = await requireUserPage("/app");

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12">
      <header className="flex items-start justify-between gap-6">
        <div>
          <p className="text-muted-foreground text-sm font-medium">
            Sessão ativa
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {identity.profile.fullName ?? identity.email ?? "Sua conta"}
          </h1>
          <p
            className="text-muted-foreground mt-2 text-sm"
            data-testid="identity-email"
          >
            {identity.email}
          </p>
        </div>
        <SignOutForm />
      </header>

      <p className="mt-10 rounded-md border border-neutral-300 px-3 py-2 text-sm">
        Em breve: seleção de empresa e workspace.
      </p>

      <nav className="mt-6 text-sm">
        <Link href="/app/account/security" className="underline">
          Segurança da conta
        </Link>
      </nav>
    </main>
  );
}
