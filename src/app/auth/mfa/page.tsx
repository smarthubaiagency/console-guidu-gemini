import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { readSessionClaims } from "@/core/auth/identity";
import { safeInternalPath } from "@/core/auth/redirects";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AuthShell } from "@/shared/ui/auth-shell";
import { SignOutForm } from "@/shared/ui/sign-out-form";
import { getRequestBrand } from "@/core/brand/resolve";

import { MfaChallengeForm } from "./mfa-challenge-form";

export const metadata: Metadata = { title: "Verificação em duas etapas" };

export default async function MfaPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const brand = await getRequestBrand();
  const claims = await readSessionClaims();
  if (!claims?.sub) redirect("/login?next=%2Fauth%2Fmfa");

  const params = await searchParams;
  const next = safeInternalPath(
    typeof params.next === "string" ? params.next : null,
  );

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.mfa.listFactors();
  const factor = data?.totp.find(
    (candidate) => candidate.status === "verified",
  );

  // Nothing to challenge: the identity has to enrol a factor first.
  if (!factor) {
    redirect(
      `/app/account/security?reason=mfa-required&next=${encodeURIComponent(next)}`,
    );
  }

  return (
    <AuthShell
      title="Verificação em duas etapas"
      description="Informe o código de seis dígitos do seu aplicativo autenticador."
      appName={brand.name}
      logoUrl={brand.logoUrl}
      footer={<SignOutForm label="Entrar com outra conta" />}
    >
      <MfaChallengeForm factorId={factor.id} next={next} />
    </AuthShell>
  );
}
