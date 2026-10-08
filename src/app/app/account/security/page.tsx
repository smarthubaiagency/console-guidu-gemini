import type { Metadata } from "next";

import { requireUserPage } from "@/core/auth/page-guard";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ErrorNotice } from "@/shared/ui/auth-shell";
import { SignOutForm } from "@/shared/ui/sign-out-form";

import { unenrolTotpFactor } from "./actions";
import { TotpEnrolment } from "./totp-enrolment";

export const metadata: Metadata = { title: "Segurança da conta" };

export default async function AccountSecurityPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  // Server-side guard. The middleware only avoids showing this shell to
  // signed-out visitors; the decision is made here.
  const identity = await requireUserPage("/app/account/security");

  const params = await searchParams;
  const mfaRequired = params.reason === "mfa-required";

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.mfa.listFactors();
  const verified =
    data?.totp.filter((factor) => factor.status === "verified") ?? [];

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12">
      <header className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Segurança</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            {identity.email ?? identity.userId}
          </p>
        </div>
        <SignOutForm />
      </header>

      {mfaRequired ? (
        <div className="mt-6">
          <ErrorNotice testId="mfa-required-state">
            Esta área exige verificação em duas etapas. Ative um aplicativo
            autenticador para continuar.
          </ErrorNotice>
        </div>
      ) : null}

      <section className="mt-10">
        <h2 className="text-lg font-medium">Verificação em duas etapas</h2>
        <p className="text-muted-foreground mt-2 text-sm">
          Aplicativo autenticador (TOTP). Obrigatório para a administração
          interna da plataforma.
        </p>

        <div className="mt-6">
          {verified.length > 0 ? (
            <ul className="space-y-3" data-testid="mfa-factors">
              {verified.map((factor) => (
                <li
                  key={factor.id}
                  className="flex items-center justify-between rounded-md border border-neutral-300 px-3 py-2 text-sm"
                >
                  <span>
                    {factor.friendly_name ?? "Aplicativo autenticador"}
                  </span>
                  <form action={unenrolTotpFactor}>
                    <input type="hidden" name="factorId" value={factor.id} />
                    <button type="submit" className="underline">
                      Remover
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <TotpEnrolment />
          )}
        </div>
      </section>
    </main>
  );
}
