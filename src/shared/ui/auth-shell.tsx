import type { ReactNode } from "react";

const appName = process.env.APP_NAME ?? "GUIDU";

/** Common frame for the identity pages: login, recovery, MFA and the states. */
export function AuthShell({
  title,
  description,
  children,
  footer,
}: Readonly<{
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}>) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
      <p className="text-muted-foreground text-sm font-medium">{appName}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1>
      {description ? (
        <p className="text-muted-foreground mt-3 text-sm">{description}</p>
      ) : null}
      <div className="mt-8">{children}</div>
      {footer ? <div className="mt-8 text-sm">{footer}</div> : null}
    </main>
  );
}

/** Inline error state for a form or page. */
export function ErrorNotice({
  children,
  testId = "error-notice",
}: Readonly<{ children: ReactNode; testId?: string }>) {
  return (
    <p
      role="alert"
      data-testid={testId}
      className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900"
    >
      {children}
    </p>
  );
}

/** Inline success/confirmation state for a form or page. */
export function SuccessNotice({
  children,
  testId = "success-notice",
}: Readonly<{ children: ReactNode; testId?: string }>) {
  return (
    <p
      role="status"
      data-testid={testId}
      className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
    >
      {children}
    </p>
  );
}
