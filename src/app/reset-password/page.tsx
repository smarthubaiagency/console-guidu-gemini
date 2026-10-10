import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { readSessionClaims } from "@/core/auth/identity";
import { AuthShell } from "@/shared/ui/auth-shell";
import { getRequestBrand } from "@/core/brand/resolve";

import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Definir nova senha" };

export default async function ResetPasswordPage() {
  const brand = await getRequestBrand();
  // Reaching this page without the recovery session means the link was never
  // consumed, already used or expired.
  const claims = await readSessionClaims();
  if (!claims?.sub) redirect("/login?error=recovery");

  return (
    <AuthShell
      title="Definir nova senha"
      description="Escolha a senha que você vai usar para entrar."
      appName={brand.name}
      logoUrl={brand.logoUrl}
    >
      <ResetPasswordForm />
    </AuthShell>
  );
}
