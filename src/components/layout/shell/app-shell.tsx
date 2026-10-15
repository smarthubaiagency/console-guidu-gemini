import { cookies } from "next/headers";

import { MaintenanceStrip } from "@/components/maintenance/maintenance-strip";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import type { ConsoleAccess } from "@/core/auth/console-access";
import type { NotificationBellData } from "@/core/notifications/bell";

import { ShellMain } from "./shell-main";
import { ShellSidebar, type ShellSidebarProps } from "./shell-sidebar";

/** Cookie the shadcn sidebar writes when it opens or collapses. */
const SIDEBAR_COOKIE = "sidebar_state";

/**
 * Standard shell of every area with a side menu (ADR 0014): the shadcn
 * sidebar-08 layout, with the content in the inset panel under a 60px header
 * (trigger and breadcrumb | search | bell, colour mode, assistant and
 * consoles).
 * The inset has the viewport height and the content scrolls inside it, so
 * the header stays in place and drawers (ADR 0015) open beside the content.
 * The open state of the sidebar is read from the cookie on the server, so
 * the first paint already has the right width. The maintenance strip
 * (CF5c) sits under the header when a window is near or in force.
 */
export async function AppShell({
  children,
  access,
  bell,
  ...sidebar
}: ShellSidebarProps &
  Readonly<{
    access: ConsoleAccess;
    /** The person's notices (`loadNotificationBell`, CF3c). */
    bell: NotificationBellData;
    children: React.ReactNode;
  }>) {
  const defaultOpen = (await cookies()).get(SIDEBAR_COOKIE)?.value !== "false";

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <ShellSidebar {...sidebar} />
      <SidebarInset className="h-svh overflow-hidden md:h-[calc(100svh-1rem)]">
        <ShellMain
          sections={sidebar.sections}
          access={access}
          bell={bell}
          notice={<MaintenanceStrip />}
        >
          {children}
        </ShellMain>
      </SidebarInset>
    </SidebarProvider>
  );
}
