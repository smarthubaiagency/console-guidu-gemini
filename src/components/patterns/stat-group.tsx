import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type StatGroupItem = Readonly<{
  label: string;
  value: ReactNode;
  icon?: ReactNode;
}>;

/**
 * Numbers side by side in a grey inset panel, split by thin lines
 * (U4, ADR 0021). Two columns on the phone, one row from `md` up.
 */
export function StatGroup({
  items,
  className,
}: Readonly<{ items: readonly StatGroupItem[]; className?: string }>) {
  return (
    <dl
      className={cn(
        "bg-surface-inset rounded-inner divide-border grid grid-cols-2 gap-y-4 py-4 md:auto-cols-fr md:grid-flow-col md:grid-cols-none md:divide-x",
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="flex flex-col gap-1 px-4">
          <dt className="text-12 text-text-secondary">{item.label}</dt>
          <dd className="text-16 text-text flex items-center gap-2 font-medium">
            {item.icon ? (
              <span aria-hidden className="text-text-secondary flex shrink-0">
                {item.icon}
              </span>
            ) : null}
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
