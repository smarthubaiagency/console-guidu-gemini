"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { ChevronDownIcon } from "lucide-react";
import { Accordion as AccordionPrimitive } from "radix-ui";

// GUIDU variant (U4, ADR 0021): `cards` turns each item into its own card
// with a bordered chevron button, as in the model pages.
function Accordion({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Root> & {
  variant?: "default" | "cards";
}) {
  return (
    <AccordionPrimitive.Root
      data-slot="accordion"
      data-variant={variant}
      className={cn(
        "group/accordion",
        variant === "cards" && "flex flex-col gap-3",
        className,
      )}
      {...props}
    />
  );
}

function AccordionItem({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn(
        "border-b last:border-b-0",
        "group-data-[variant=cards]/accordion:bg-card group-data-[variant=cards]/accordion:border-border group-data-[variant=cards]/accordion:shadow-card group-data-[variant=cards]/accordion:rounded-card group-data-[variant=cards]/accordion:border group-data-[variant=cards]/accordion:px-4 group-data-[variant=cards]/accordion:last:border-b",
        className,
      )}
      {...props}
    />
  );
}

function AccordionTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-start justify-between gap-4 rounded-md py-4 text-left text-sm font-medium transition-all outline-none hover:underline focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&[data-state=open]_[data-slot=accordion-chevron]>svg]:rotate-180",
          "group-data-[variant=cards]/accordion:min-w-0 group-data-[variant=cards]/accordion:items-center group-data-[variant=cards]/accordion:py-3 group-data-[variant=cards]/accordion:hover:no-underline",
          className,
        )}
        {...props}
      >
        {children}
        <span
          data-slot="accordion-chevron"
          className="text-muted-foreground group-data-[variant=cards]/accordion:border-border group-data-[variant=cards]/accordion:bg-background pointer-events-none flex shrink-0 translate-y-0.5 items-center justify-center group-data-[variant=cards]/accordion:size-8 group-data-[variant=cards]/accordion:translate-y-0 group-data-[variant=cards]/accordion:rounded-md group-data-[variant=cards]/accordion:border"
        >
          <ChevronDownIcon className="size-4 transition-transform duration-200" />
        </span>
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

function AccordionContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      data-slot="accordion-content"
      className="data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down overflow-hidden text-sm"
      {...props}
    >
      <div className={cn("pt-0 pb-4", className)}>{children}</div>
    </AccordionPrimitive.Content>
  );
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
