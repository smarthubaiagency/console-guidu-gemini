import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { AuthShell, ErrorNotice } from "@/shared/ui/auth-shell";
import { SignOutForm } from "@/shared/ui/sign-out-form";
import { getRequestBrand } from "@/core/brand/resolve";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("denied.title") };
}

/**
 * State shown when the identity is valid and active but lacks access to the
 * requested resource. It never names the resource: that would confirm another
 * customer's data exists.
 */
export default async function AccessDeniedPage() {
  const brand = await getRequestBrand();
  const t = await getTranslations("auth.denied");
  return (
    <AuthShell
      title={t("title")}
      description={t("description")}
      brand={brand}
      footer={
        <div className="flex items-center gap-4">
          <Link href="/app" className="underline">
            {t("back")}
          </Link>
          <SignOutForm />
        </div>
      }
    >
      <ErrorNotice testId="denied-state">{t("notice")}</ErrorNotice>
    </AuthShell>
  );
}
