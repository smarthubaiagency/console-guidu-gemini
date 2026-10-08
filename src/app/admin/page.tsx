import type { Metadata } from "next";

import { requireMfaPage } from "@/core/auth/page-guard";
import { SignOutForm } from "@/shared/ui/sign-out-form";

export const metadata: Metadata = { title: "Administração" };

/**
 * Entry point of the internal administration.
 *
 * MFA is mandatory here (specification sections 8 and 19), enforced on the
 * server by `requireMfa()`. The internal role matrix arrives with F1.4; until
 * then this page only proves the identity gate, with no operational data.
 */
export default async function AdminPage() {
  const identity = await requireMfaPage("/admin");

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12">
      <header className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Administração
          </h1>
          <p
            className="text-muted-foreground mt-2 text-sm"
            data-testid="admin-identity"
          >
            {identity.email ?? identity.userId}
          </p>
        </div>
        <SignOutForm />
      </header>

      <p
        className="mt-10 rounded-md border border-neutral-300 px-3 py-2 text-sm"
        data-testid="admin-state"
      >
        Sessão com segundo fator verificado. Em breve: visão operacional,
        clientes e assinaturas.
      </p>
    </main>
  );
}
