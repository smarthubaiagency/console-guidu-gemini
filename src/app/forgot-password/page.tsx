import type { Metadata } from "next";

import { AuthShell } from "@/shared/ui/auth-shell";
import { getRequestBrand } from "@/core/brand/resolve";

import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Recuperar senha" };

export default async function ForgotPasswordPage() {
  const brand = await getRequestBrand();
  return (
    <AuthShell
      title="Recuperar senha"
      description="Enviamos um link para você definir uma nova senha."
      appName={brand.name}
      logoUrl={brand.logoUrl}
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
