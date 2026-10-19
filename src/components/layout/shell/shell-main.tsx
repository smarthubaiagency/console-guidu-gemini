"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Bot, Handshake, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";

import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  WorkbenchDrawer,
  WorkbenchPanel,
  WorkbenchProvider,
  type WorkbenchPanelSize,
} from "@/components/layout/workbench";
import { SmartStatusBanner } from "@/components/feedback/smart-status-banner";
import { StatusProvider } from "@/components/feedback/status-context";
import type { ConsoleAccess } from "@/core/auth/console-access";
import type { NavSection } from "@/core/module-runtime/navigation";
import type { NotificationBellData } from "@/core/notifications/bell";
import { cn } from "@/lib/utils";

import { HeaderAction, ThemeToggle } from "./header-action";
import { NotificationBell } from "./notification-bell";
import { ShellBreadcrumb } from "./shell-breadcrumb";
import { ShellSearch } from "./shell-search";

/**
 * Content side of the shell (ADR 0014): the 60px header (trigger and
 * breadcrumb | search | bell, colour mode, assistant and consoles) and the
 * scrolling content, with the assistant in the internal drawer (ADR 0015)
 * and the SmartStatusBanner under the header (ADR 0016).
 */
export function ShellMain({
  sections,
  access,
  bell,
  notice,
  children,
}: Readonly<{
  sections: readonly NavSection[];
  access: ConsoleAccess;
  bell: NotificationBellData;
  /** Strip under the header, rendered on the server (maintenance, CF5c). */
  notice?: React.ReactNode;
  children: React.ReactNode;
}>) {
  const t = useTranslations("shell");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantSize, setAssistantSize] =
    useState<WorkbenchPanelSize>("default");
  const assistant = useMemo(
    () => ({
      panelOpen: assistantOpen,
      setPanelOpen: setAssistantOpen,
      panelSize: assistantSize,
      setPanelSize: setAssistantSize,
    }),
    [assistantOpen, assistantSize],
  );

  return (
    <StatusProvider>
      <WorkbenchProvider value={assistant}>
        <header
          data-slot="shell-header"
          className="border-border flex h-15 shrink-0 items-center gap-2 border-b px-4"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <SidebarTrigger
              className="-ml-1"
              aria-label={t("toggleSidebar")}
              data-testid="sidebar-trigger"
            />
            <Separator
              orientation="vertical"
              className="mr-2 data-[orientation=vertical]:h-4"
            />
            <ShellBreadcrumb sections={sections} />
          </div>
          <div className="flex justify-center md:flex-1">
            <ShellSearch sections={sections} />
          </div>
          <div className="flex items-center justify-end gap-1 md:flex-1">
            <NotificationBell data={bell} />
            <ThemeToggle />
            <HeaderAction
              label={t("assistant")}
              testId="assistant-toggle"
              aria-pressed={assistantOpen}
              onClick={() => setAssistantOpen(!assistantOpen)}
            >
              <Bot />
            </HeaderAction>
            {access.admin ? (
              <HeaderAction label={t("adminLink")} testId="admin-link" asChild>
                <Link href="/admin">
                  <Handshake />
                </Link>
              </HeaderAction>
            ) : null}
            {access.platform ? (
              <HeaderAction
                label={t("platformLink")}
                testId="platform-link"
                asChild
              >
                <Link href="/platform">
                  <ShieldCheck />
                </Link>
              </HeaderAction>
            ) : null}
          </div>
        </header>
        {notice}
        <div className="relative min-h-0 flex-1">
          <div
            data-slot="shell-content"
            className={cn(
              "h-full overflow-y-auto p-4 transition-all duration-500 ease-in-out motion-reduce:transition-none md:p-6",
              // Pages built on the model cards (U4, ADR 0021) get the grey canvas.
              "has-data-[slot=page-canvas]:bg-surface-canvas",
              assistantOpen && assistantSize === "default" && "lg:pr-drawer",
            )}
          >
            {children}
          </div>
          <WorkbenchDrawer label={t("assistant")}>
            <WorkbenchPanel
              title={t("assistant")}
              description={t("assistantSoonTitle")}
            >
              <p className="text-14 text-text-subtle">
                {t("assistantSoonText")}
              </p>
            </WorkbenchPanel>
          </WorkbenchDrawer>
          <SmartStatusBanner />
        </div>
      </WorkbenchProvider>
    </StatusProvider>
  );
}
