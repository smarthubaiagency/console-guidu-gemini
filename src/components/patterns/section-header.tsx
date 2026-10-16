import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Title, grey description and actions on the right (U4, ADR 0021). */
export function SectionHeader({
  title,
  description,
  actions,
  level = 2,
  className,
}: Readonly<{
  title: string;
  description?: string;
  actions?: ReactNode;
  level?: 2 | 3;
  className?: string;
}>) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <div className={cn("flex flex-wrap items-start gap-3", className)}>
      <div className="min-w-0 flex-1">
        <Heading className="text-18 text-text font-semibold">{title}</Heading>
        {description ? (
          <p className="text-14 text-text-secondary">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
