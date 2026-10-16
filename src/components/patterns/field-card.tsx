import type { ReactNode } from "react";

import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";

/**
 * A read-only value in a small card: label above, value below and an action
 * on the right, such as copy or open (U4, ADR 0021). Built on shadcn `Item`.
 */
export function FieldCard({
  label,
  value,
  icon,
  action,
  className,
}: Readonly<{
  label: string;
  value: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}>) {
  return (
    <Item variant="card" size="sm" className={className}>
      {icon ? <ItemMedia variant="icon">{icon}</ItemMedia> : null}
      <ItemContent className="min-w-0 gap-0.5">
        <ItemDescription className="text-12">{label}</ItemDescription>
        <ItemTitle className="text-16 block w-full truncate">{value}</ItemTitle>
      </ItemContent>
      {action ? <ItemActions>{action}</ItemActions> : null}
    </Item>
  );
}
