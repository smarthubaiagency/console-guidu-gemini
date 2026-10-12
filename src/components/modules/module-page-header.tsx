import type { ReactNode } from "react";

/**
 * Title block at the top of a page. The breadcrumb lives only in the shell
 * header (ADR 0014), so pages never repeat it here.
 */
export function ModulePageHeader({
  title,
  description,
  icon,
  actions,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  /** Page actions on the right, such as "New". */
  actions?: ReactNode;
}) {
  return (
    <div className="border-border border-b pb-5">
      <div className="flex flex-wrap items-center gap-3">
        {icon && (
          <div className="bg-surface-hover text-text-subtle rounded-lg p-2">
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-20 text-text font-bold tracking-tight">
            {title}
          </h1>
          {description && (
            <p className="text-12 text-text-secondary">{description}</p>
          )}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}
