"use client";

import { useRef } from "react";
import Link from "next/link";
import {
  BadgeCheck,
  Bell,
  ChevronsUpDown,
  Languages,
  LogOut,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

export type ShellUser = Readonly<{
  email: string | undefined;
  /** Role shown under the e-mail; the account label when absent. */
  role?: string | null | undefined;
}>;

function initials(email: string | undefined): string {
  return email ? email.slice(0, 2).toUpperCase() : "?";
}

function Identity({ user }: Readonly<{ user: ShellUser }>) {
  const t = useTranslations("shell");
  return (
    <>
      <Avatar className="h-8 w-8 rounded-lg">
        <AvatarFallback className="rounded-lg">
          {initials(user.email)}
        </AvatarFallback>
      </Avatar>
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium" data-testid="user-identity">
          {user.email ?? t("myAccount")}
        </span>
        <span className="truncate text-xs">{user.role ?? t("myAccount")}</span>
      </div>
    </>
  );
}

/**
 * Account menu in the sidebar-08 footer (ADR 0014). Logout stays a plain
 * form post to /auth/signout, which checks the Origin header.
 */
export function NavUser({ user }: Readonly<{ user: ShellUser }>) {
  const t = useTranslations("shell");
  const tu = useTranslations("ui");
  const { isMobile } = useSidebar();
  const signOut = useRef<HTMLFormElement>(null);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <form ref={signOut} method="post" action="/auth/signout" hidden />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              data-testid="user-menu"
              aria-label={t("userMenu")}
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Identity user={user} />
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Identity user={user} />
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <Link href="/app/account/security">
                  <BadgeCheck />
                  {t("myAccount")}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/app/account/language">
                  <Languages />
                  {t("language")}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/app/account/notifications">
                  <Bell />
                  {t("notifications")}
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-testid="sign-out"
              onSelect={() => signOut.current?.requestSubmit()}
            >
              <LogOut />
              {tu("signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
