"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { ArrowLeft, HelpCircle } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar";
import type { NavSection } from "@/core/module-runtime/navigation";

import { activeNavItemId } from "../nav-active";
import { NavMain } from "./nav-main";
import { NavSecondary, type SecondaryItem } from "./nav-secondary";
import { NavUser, type ShellUser } from "./nav-user";

export type ShellArea = "app" | "admin" | "platform";

export type ShellSidebarProps = Readonly<{
  area: ShellArea;
  /** Generated on the server from core entries and the module registry. */
  sections: readonly NavSection[];
  /** Top of the sidebar: workspace switcher or console identity. */
  header: React.ReactNode;
  user: ShellUser;
}>;

/**
 * The project's only sidebar: the shadcn sidebar-08 block (inset variant),
 * filled with the navigation of each area (ADR 0014).
 */
export function ShellSidebar({
  area,
  sections,
  header,
  user,
}: ShellSidebarProps) {
  const t = useTranslations("shell");
  const pathname = usePathname();
  const activeId = activeNavItemId(sections, pathname);

  const secondary: SecondaryItem[] = [
    {
      id: "documentation",
      title: t("documentation"),
      icon: HelpCircle,
      href: null,
      badge: "v1.0",
    },
  ];
  if (area !== "app") {
    secondary.push({
      id: "back-to-app",
      title: t("backToApp"),
      icon: ArrowLeft,
      href: "/app",
    });
  }

  return (
    <Sidebar variant="inset">
      <SidebarHeader>{header}</SidebarHeader>
      <SidebarContent>
        <NavMain sections={sections} activeId={activeId} />
        <NavSecondary items={secondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}
