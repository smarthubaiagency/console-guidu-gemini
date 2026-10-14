import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { readSessionClaims } from "@/core/auth/identity";
import { AuthShell } from "@/shared/ui/auth-shell";
import { getRequestBrand } from "@/core/brand/resolve";

import { ResetPasswordForm } from "./reset-password-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("resetPassword.title") };
}

export default async function ResetPasswordPage() {
  const brand = await getRequestBrand();
  // Reaching this page without the recovery session means the link was never
  // consumed, already used or expired.
  const claims = await readSessionClaims();
  if (!claims?.sub) redirect("/login?error=recovery");
  const t = await getTranslations("auth.resetPassword");

  return (
    <AuthShell title={t("title")} description={t("description")} brand={brand}>
      <ResetPasswordForm />
    </AuthShell>
  );
}
