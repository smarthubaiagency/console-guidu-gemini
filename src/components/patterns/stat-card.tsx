import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * A number with its label (U4, ADR 0021). `framed` is the card inside a
 * grey frame whose top carries the icon and label; `flush` is the same with
 * the white card meeting the frame on the sides and bottom (the "Portfolio
 * Growth" model); `plain` is one card.
 */
export function StatCard({
  label,
  value,
  caption,
  icon,
  action,
  variant = "framed",
  className,
}: Readonly<{
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  icon?: ReactNode;
  /** Small control on the right of the label, such as a menu button. */
  action?: ReactNode;
  variant?: "framed" | "flush" | "plain";
  className?: string;
}>) {
  const labelRow = (
    <div className="text-12 text-text-secondary flex items-center gap-2">
      {icon ? (
        <span aria-hidden className="flex shrink-0">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {action}
    </div>
  );
  const body = (
    <>
      <div className="text-24 text-text font-semibold tracking-tight">
        {value}
      </div>
      {caption ? (
        <div className="text-12 text-text-secondary">{caption}</div>
      ) : null}
    </>
  );

  if (variant === "plain") {
    return (
      <Card variant="surface" className={cn("gap-2 px-5", className)}>
        {labelRow}
        {body}
      </Card>
    );
  }
  if (variant === "flush") {
    return (
      <Card variant="framed" className={cn("p-0", className)}>
        <div className="px-4 py-2.5">{labelRow}</div>
        <div className="bg-card border-border rounded-card -mx-px -mb-px flex flex-col gap-1 border px-4 pt-4 pb-4">
          {body}
        </div>
      </Card>
    );
  }
  return (
    <Card variant="framed" className={className}>
      <div className="px-3 py-2">{labelRow}</div>
      <div className="bg-card border-border rounded-inner shadow-card flex flex-col gap-1 border p-4">
        {body}
      </div>
    </Card>
  );
}
