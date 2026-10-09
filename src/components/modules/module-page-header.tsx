import type { ReactNode } from "react";

/** Standard header used by module pages and module settings hosts. */
export function ModulePageHeader({
  trail,
  title,
  description,
  icon,
}: {
  trail: readonly string[];
  title: string;
  description?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="border-border border-b pb-5">
      <div className="text-12 text-text-secondary mb-1 flex items-center gap-2 font-medium">
        {trail.map((part, index) => (
          <span key={`${part}-${index}`} className="flex items-center gap-2">
            {index > 0 && <span>/</span>}
            <span>{part}</span>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-3">
        {icon && (
          <div className="bg-surface-hover text-text-subtle rounded-lg p-2">
            {icon}
          </div>
        )}
        <div>
          <h1 className="text-20 text-text font-bold tracking-tight">
            {title}
          </h1>
          {description && (
            <p className="text-12 text-text-secondary">{description}</p>
          )}
        </div>
      </div>
    </div>
  );
}
