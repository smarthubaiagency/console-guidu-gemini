import type { ReactNode } from "react";

import { PageStatus } from "@/components/feedback/page-status";

import { BrandMark } from "./brand-mark";

/**
 * Common frame for the identity pages: login, recovery, MFA and the states.
 * Form results go to the SmartStatusBanner (ADR 0016), fixed at the top.
 */
export function AuthShell({
  title,
  description,
  children,
  footer,
  appName,
  logoUrl,
}: Readonly<{
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  appName?: string;
  logoUrl?: string | null | undefined;
}>) {
  return (
    <PageStatus>
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
        {appName ? (
          <div className="flex items-center gap-2">
            <BrandMark name={appName} logoUrl={logoUrl} />
            <p className="text-text-secondary text-14 font-medium">{appName}</p>
          </div>
        ) : null}
        <h1 className="text-30 mt-2 font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="text-text-secondary text-14 mt-3">{description}</p>
        ) : null}
        <div className="mt-8">{children}</div>
        {footer ? <div className="text-14 mt-8">{footer}</div> : null}
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
