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
export default async function AccessDeniedPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const brand = await getRequestBrand();
  const t = await getTranslations("auth.denied");
  // The console's IP allow list refused the address (CF5a). Only the
  // area's own members are sent here with this reason.
  const ipBlocked = (await searchParams).reason === "ip";
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
      <ErrorNotice testId={ipBlocked ? "denied-ip" : "denied-state"}>
        {ipBlocked ? t("ipNotice") : t("notice")}
      </ErrorNotice>
    </AuthShell>
  );
}
