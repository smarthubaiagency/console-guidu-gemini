import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Root of a page built on the model cards (U4, ADR 0021). The shell paints
 * the grey canvas behind it (`data-slot="page-canvas"`), so the white cards
 * stand out; the page uses the full width of the content area.
 */
export function PageCanvas({
  className,
  children,
}: Readonly<{ className?: string; children: ReactNode }>) {
  return (
    <div
      data-slot="page-canvas"
      className={cn("flex flex-col gap-6", className)}
    >
      {children}
    </div>
  );
}
