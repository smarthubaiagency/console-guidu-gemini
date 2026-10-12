import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

import { ShellBreadcrumb } from "./shell-breadcrumb";
import { ShellSidebar, type ShellSidebarProps } from "./shell-sidebar";

/** Cookie the shadcn sidebar writes when it opens or collapses. */
const SIDEBAR_COOKIE = "sidebar_state";

/**
 * Standard shell of every area with a side menu (ADR 0014): the shadcn
 * sidebar-08 layout, with the content in the inset panel and a header with
 * the collapse button and the breadcrumb. The open state is read from the
 * cookie on the server, so the first paint already has the right width.
 */
export async function AppShell({
  children,
  ...sidebar
}: ShellSidebarProps & Readonly<{ children: React.ReactNode }>) {
  const defaultOpen = (await cookies()).get(SIDEBAR_COOKIE)?.value !== "false";
  const t = await getTranslations("shell");

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <ShellSidebar {...sidebar} />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger
              className="-ml-1"
              aria-label={t("toggleSidebar")}
              data-testid="sidebar-trigger"
            />
            <Separator
              orientation="vertical"
              className="mr-2 data-[orientation=vertical]:h-4"
            />
            <ShellBreadcrumb sections={sidebar.sections} />
          </div>
        </header>
        <div className="flex flex-1 flex-col p-4 pt-0 md:p-6 md:pt-0">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
