"use client";

import { X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Tags as pills, with an optional remove button and a `+N` counter for what
 * does not fit (U4, ADR 0021).
 */
export function TagList({
  tags,
  max,
  onRemove,
  removeLabel,
  moreLabel,
  className,
}: Readonly<{
  tags: readonly string[];
  /** How many tags to show before the `+N` counter. */
  max?: number;
  onRemove?: (tag: string) => void;
  /** Accessible name of the remove button, e.g. `(tag) => "Remover " + tag`. */
  removeLabel?: (tag: string) => string;
  /** Accessible name of the counter, e.g. `(n) => n + " a mais"`. */
  moreLabel?: (count: number) => string;
  className?: string;
}>) {
  const shown = max === undefined ? tags : tags.slice(0, max);
  const hidden = tags.length - shown.length;
  return (
    <ul className={cn("flex flex-wrap items-center gap-2", className)}>
      {shown.map((tag) => (
        <li key={tag}>
          <Badge variant="outline" className="text-12 h-8 gap-1.5 px-3">
            {tag}
            {onRemove ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="-mr-1.5 rounded-full"
                aria-label={removeLabel ? removeLabel(tag) : tag}
                onClick={() => onRemove(tag)}
              >
                <X />
              </Button>
            ) : null}
          </Badge>
        </li>
      ))}
      {hidden > 0 ? (
        <li>
          <Badge
            variant="outline"
            className="text-12 h-8 px-3"
            aria-label={moreLabel ? moreLabel(hidden) : undefined}
          >
            +{hidden}
          </Badge>
        </li>
      ) : null}
    </ul>
  );
}
