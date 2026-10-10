import type { Metadata } from "next";

import { AUTH_MESSAGES } from "@/core/auth/form-state";
import { safeInternalPath } from "@/core/auth/redirects";
import { AuthShell, ErrorNotice, SuccessNotice } from "@/shared/ui/auth-shell";
import { getRequestBrand } from "@/core/brand/resolve";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

/** Error codes other pages may hand to /login through the query string. */
const ARRIVAL_ERRORS: Readonly<Record<string, string>> = {
  unavailable: AUTH_MESSAGES.unavailable,
  callback: "Não foi possível concluir a autenticação. Tente entrar de novo.",
  expired: "Sua sessão expirou. Entre novamente.",
  recovery: AUTH_MESSAGES.recoveryLinkInvalid,
};

const ARRIVAL_NOTICES: Readonly<Record<string, string>> = {
  "password-updated": AUTH_MESSAGES.passwordUpdated,
  "signed-out": "Você saiu da sua conta.",
};

export default async function LoginPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const brand = await getRequestBrand();
  const params = await searchParams;
  const nextParam = typeof params.next === "string" ? params.next : null;
  const errorCode = typeof params.error === "string" ? params.error : null;
  const arrivalError = errorCode ? ARRIVAL_ERRORS[errorCode] : undefined;
  const noticeCode = typeof params.notice === "string" ? params.notice : null;
  const arrivalNotice = noticeCode ? ARRIVAL_NOTICES[noticeCode] : undefined;

  return (
    <AuthShell
      title="Entrar"
      description={`Use o e-mail e a senha da sua conta ${brand.name}.`}
      appName={brand.name}
      logoUrl={brand.logoUrl}
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
