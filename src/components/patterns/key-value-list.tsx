import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type KeyValueItem = Readonly<{ label: string; value: ReactNode }>;

/** Label and value pairs split by thin lines (U4, ADR 0021). */
export function KeyValueList({
  items,
  className,
}: Readonly<{ items: readonly KeyValueItem[]; className?: string }>) {
  return (
    <dl className={cn("divide-border flex flex-col divide-y", className)}>
      {items.map((item) => (
        <div
          key={item.label}
          className="text-14 flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
        >
          <dt className="text-text-secondary">{item.label}</dt>
          <dd className="text-text text-right font-medium">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
