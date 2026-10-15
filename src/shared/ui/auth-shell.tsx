import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";

import { PageStatus } from "@/components/feedback/page-status";
import type { Brand } from "@/core/brand/types";

import { BrandFooterText, BrandWhatsappLink } from "./brand-contact";
import { BrandMark } from "./brand-mark";

/**
 * Common frame for the identity pages: login, recovery, MFA and the states.
 * Form results go to the SmartStatusBanner (ADR 0016), fixed at the top.
 * With the host brand it shows the logo, the tagline and the brand footer;
 * `salesContact` adds the WhatsApp sales button (CF2, login only).
 * `notice` tops the page: the login passes the maintenance strip (CF5c).
 * This file stays free of server-only imports: client forms use its notices.
 */
export async function AuthShell({
  title,
  description,
  children,
  footer,
  brand,
  salesContact = false,
  notice,
}: Readonly<{
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  brand?: Brand;
  salesContact?: boolean;
  notice?: ReactNode;
}>) {
  const whatsapp = salesContact ? brand?.whatsapp : null;
  const t = whatsapp ? await getTranslations("brand.form") : null;
  return (
    <PageStatus>
      {notice}
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
        {brand ? (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <BrandMark
                name={brand.name}
                logoUrl={brand.logoUrl}
                logoDarkUrl={brand.logoDarkUrl}
              />
              <p className="text-text-secondary text-14 font-medium">
                {brand.name}
              </p>
            </div>
            {brand.tagline ? (
              <p
                className="text-text-tertiary text-12"
                data-testid="brand-tagline"
              >
                {brand.tagline}
              </p>
            ) : null}
          </div>
        ) : null}
        <h1 className="text-30 mt-2 font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="text-text-secondary text-14 mt-3">{description}</p>
        ) : null}
        <div className="mt-8">{children}</div>
        {footer ? <div className="text-14 mt-8">{footer}</div> : null}
        {whatsapp && t ? (
          <div className="mt-8">
            <BrandWhatsappLink
              whatsapp={whatsapp}
              fallbackLabel={t("whatsappDefaultLabel")}
            />
          </div>
        ) : null}
        {brand?.footerText ? (
          <footer className="border-card-border mt-10 border-t pt-4">
            <BrandFooterText text={brand.footerText} />
          </footer>
        ) : null}
      </main>
    </PageStatus>
  );
}

/**
 * Inline error state of a page (expired link, access denied). A form result
 * goes to the SmartStatusBanner instead (ADR 0016).
 */
export function ErrorNotice({
  children,
  testId = "error-notice",
}: Readonly<{ children: ReactNode; testId?: string }>) {
  return (
    <p
      role="alert"
      data-testid={testId}
      className="border-danger-border bg-danger-bg text-14 text-danger-text rounded-md border px-3 py-2"
    >
      {children}
    </p>
  );
}

/** Inline success state of a page (invitation accepted, arrival notice). */
export function SuccessNotice({
  children,
  testId = "success-notice",
}: Readonly<{ children: ReactNode; testId?: string }>) {
  return (
    <p
      role="status"
      data-testid={testId}
      className="border-success-border bg-success-bg text-14 text-success-text rounded-md border px-3 py-2"
    >
      {children}
    </p>
  );
}
