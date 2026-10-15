import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { safeInternalPath } from "@/core/auth/redirects";
import { MaintenanceStrip } from "@/components/maintenance/maintenance-strip";
import { AuthShell, ErrorNotice, SuccessNotice } from "@/shared/ui/auth-shell";
import { getRequestBrand } from "@/core/brand/resolve";

import { LoginForm } from "./login-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("login.title") };
}

/**
 * Error codes other pages may hand to /login through the query string, and
 * the key (in `auth`) of the text each one shows.
 */
const ARRIVAL_ERRORS: Readonly<Record<string, string>> = {
  unavailable: "errors.unavailable",
  callback: "arrival.callback",
  expired: "arrival.expired",
  recovery: "errors.recoveryLinkInvalid",
};

const ARRIVAL_NOTICES: Readonly<Record<string, string>> = {
  "password-updated": "messages.passwordUpdated",
  "signed-out": "messages.signedOut",
};

export default async function LoginPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const brand = await getRequestBrand();
  const t = await getTranslations("auth");
  const params = await searchParams;
  const nextParam = typeof params.next === "string" ? params.next : null;
  const errorCode = typeof params.error === "string" ? params.error : null;
  const errorKey = errorCode ? ARRIVAL_ERRORS[errorCode] : undefined;
  const arrivalError = errorKey ? t(errorKey) : undefined;
  const noticeCode = typeof params.notice === "string" ? params.notice : null;
  const noticeKey = noticeCode ? ARRIVAL_NOTICES[noticeCode] : undefined;
  const arrivalNotice = noticeKey ? t(noticeKey) : undefined;

  return (
    <AuthShell
      title={t("login.title")}
      description={t("login.description", { appName: brand.name })}
      brand={brand}
      salesContact
      notice={<MaintenanceStrip />}
    >
      {arrivalError ? (
        <div className="mb-4">
          <ErrorNotice testId="arrival-error">{arrivalError}</ErrorNotice>
        </div>
      ) : null}
      {arrivalNotice ? (
        <div className="mb-4">
          <SuccessNotice testId="arrival-notice">{arrivalNotice}</SuccessNotice>
        </div>
      ) : null}
      <LoginForm next={safeInternalPath(nextParam)} />
    </AuthShell>
  );
}
