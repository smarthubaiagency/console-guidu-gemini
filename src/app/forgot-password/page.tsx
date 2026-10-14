import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { AuthShell } from "@/shared/ui/auth-shell";
import { getRequestBrand } from "@/core/brand/resolve";

import { ForgotPasswordForm } from "./forgot-password-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("forgotPassword.title") };
}

export default async function ForgotPasswordPage() {
  const brand = await getRequestBrand();
  const t = await getTranslations("auth.forgotPassword");
  return (
    <AuthShell title={t("title")} description={t("description")} brand={brand}>
      <ForgotPasswordForm />
    </AuthShell>
  );
}
