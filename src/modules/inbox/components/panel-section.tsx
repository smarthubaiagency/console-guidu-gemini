"use client";

import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";

/**
 * One section of the "Contato" tab of the context panel (IN4c): an item of
 * the `cards` accordion of the model components (ADR 0021), as in
 * /platform/design/example. The panel decides which ones start open.
 */
export function PanelSection({
  value,
  title,
  testId,
  className,
  children,
}: Readonly<{
  value: string;
  title: string;
  testId: string;
  className?: string;
  children: React.ReactNode;
}>) {
  return (
    <AccordionItem value={value} data-testid={testId}>
      <AccordionTrigger className="text-14 font-semibold">
        {title}
      </AccordionTrigger>
      <AccordionContent className={cn("space-y-3", className)}>
        {children}
      </AccordionContent>
    </AccordionItem>
  );
}
