import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { AuthShell, ErrorNotice } from "@/shared/ui/auth-shell";
import { SignOutForm } from "@/shared/ui/sign-out-form";
import { getRequestBrand } from "@/core/brand/resolve";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("suspended.title") };
}

/**
 * State shown when the identity is authenticated but blocked or suspended.
 * No workspace data is loaded here — the account cannot operate.
 */
export default async function SuspendedPage() {
  const brand = await getRequestBrand();
  const t = await getTranslations("auth.suspended");
  return (
    <AuthShell
      title={t("title")}
      description={t("description")}
      appName={brand.name}
      logoUrl={brand.logoUrl}
      footer={<SignOutForm />}
    >
      <ErrorNotice testId="suspended-state">{t("notice")}</ErrorNotice>
    </AuthShell>
  );
}
