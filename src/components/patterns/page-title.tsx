import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Page title with an icon tile, description and actions (U4, ADR 0021).
 * The breadcrumb stays in the shell header (ADR 0014); this is the page's
 * single `h1`.
 */
export function PageTitle({
  title,
  description,
  icon,
  actions,
  className,
}: Readonly<{
  title: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
}>) {
  return (
    <div className={cn("flex flex-wrap items-center gap-4", className)}>
      {icon ? (
        <div
          aria-hidden
          className="bg-primary-subtle text-primary-text border-info-border rounded-inner flex size-12 shrink-0 items-center justify-center border"
        >
          {icon}
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <h1 className="text-24 text-text font-semibold tracking-tight">
          {title}
        </h1>
        {description ? (
          <p className="text-14 text-text-secondary">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
