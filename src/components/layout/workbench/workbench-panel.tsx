"use client";

import { Maximize2, Minimize2, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

import { useWorkbench } from "./workbench-layout";

/**
 * Standard frame of the workbench drawer (ADR 0015): title, expand
 * (350 ↔ 700px) and close on top, scrolling body, actions in the footer.
 */
export function WorkbenchPanel({
  title,
  description,
  footer,
  children,
}: Readonly<{
  title: string;
  description?: string;
  /** Actions such as Save and Cancel, always visible. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}>) {
  const t = useTranslations("shell");
  const { panelSize, setPanelSize, setPanelOpen } = useWorkbench();
  const wide = panelSize === "wide";

  return (
    <>
      <header className="border-border flex shrink-0 items-start gap-2 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-14 text-text truncate font-semibold">{title}</h2>
          {description ? (
            <p className="text-12 text-text-secondary truncate">
              {description}
            </p>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="hidden lg:inline-flex"
          aria-label={wide ? t("workbenchCollapse") : t("workbenchExpand")}
          title={wide ? t("workbenchCollapse") : t("workbenchExpand")}
          data-testid="workbench-resize"
          onClick={() => setPanelSize(wide ? "default" : "wide")}
        >
          {wide ? <Minimize2 /> : <Maximize2 />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("workbenchClose")}
          title={t("workbenchClose")}
          data-testid="workbench-close"
          onClick={() => setPanelOpen(false)}
        >
          <X />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      {footer ? (
        <footer className="border-border flex shrink-0 justify-end gap-2 border-t px-4 py-3">
          {footer}
        </footer>
      ) : null}
    </>
  );
}
