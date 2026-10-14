"use client";

import Link from "next/link";
import { Building2, Check, ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import type { UserWorkspace } from "@/core/workspaces/navigation";
import { BrandMark } from "@/shared/ui/brand-mark";

interface WorkspaceSwitcherProps {
  currentSlug: string;
  workspaces: UserWorkspace[];
  appName: string;
  logoUrl?: string | null | undefined;
  logoDarkUrl?: string | null | undefined;
}

/**
 * Top of the customer sidebar (ADR 0014): brand, current workspace and the
 * switch to any other workspace of the person, without leaving the session.
 */
export function WorkspaceSwitcher({
  currentSlug,
  workspaces,
  appName,
  logoUrl,
  logoDarkUrl,
}: WorkspaceSwitcherProps) {
  const t = useTranslations("shell");
  const { isMobile } = useSidebar();
  const active = workspaces.find((w) => w.workspaceSlug === currentSlug);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              data-testid="workspace-switcher"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex aspect-square size-8 items-center justify-center overflow-hidden rounded-lg">
                <BrandMark
                  name={appName}
                  logoUrl={logoUrl}
                  logoDarkUrl={logoDarkUrl}
                  size="md"
                />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">
                  {active?.workspaceName ?? currentSlug}
                </span>
                <span className="truncate text-xs" data-testid="shell-brand">
                  {appName}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="start"
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              {t("workspaces")}
            </DropdownMenuLabel>
            {workspaces.map((ws) => (
              <DropdownMenuItem key={ws.workspaceId} asChild className="gap-2">
                <Link href={`/app/${ws.workspaceSlug}`}>
                  <Building2 />
                  <div className="grid flex-1 leading-tight">
                    <span className="truncate font-medium">
                      {ws.workspaceName}
                    </span>
                    <span className="text-muted-foreground truncate text-xs">
                      {ws.organizationName} • {ws.workspaceRole}
                    </span>
                  </div>
                  {ws.workspaceSlug === currentSlug ? <Check /> : null}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
