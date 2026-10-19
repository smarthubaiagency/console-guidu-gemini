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
import { Button } from "@/components/ui/button";
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

/** The items of the account menu, shared by the sidebar and the headers. */
function UserMenuBody({
  user,
  onSignOut,
}: Readonly<{ user: ShellUser; onSignOut: () => void }>) {
  const t = useTranslations("shell");
  const tu = useTranslations("ui");
  return (
    <>
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
      <DropdownMenuItem data-testid="sign-out" onSelect={onSignOut}>
        <LogOut />
        {tu("signOut")}
      </DropdownMenuItem>
    </>
  );
}

/**
 * Account menu in the sidebar-08 footer (ADR 0014). Logout stays a plain
 * form post to /auth/signout, which checks the Origin header.
 */
export function NavUser({ user }: Readonly<{ user: ShellUser }>) {
  const t = useTranslations("shell");
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
            <UserMenuBody
              user={user}
              onSignOut={() => signOut.current?.requestSubmit()}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/**
 * The same account menu at the right end of a 60px header, for windows
 * without the sidebar (the Inbox in full screen, IN4c): the avatar and,
 * from `md` up, the e-mail and the role.
 */
export function HeaderUserMenu({
  user,
  testId = "header-user-menu",
}: Readonly<{ user: ShellUser; testId?: string }>) {
  const t = useTranslations("shell");
  const signOut = useRef<HTMLFormElement>(null);

  return (
    <>
      <form ref={signOut} method="post" action="/auth/signout" hidden />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            data-testid={testId}
            aria-label={t("userMenu")}
            className="h-10 gap-2 px-1.5 md:px-2"
          >
            <Avatar className="h-8 w-8 rounded-lg">
              <AvatarFallback className="rounded-lg">
                {initials(user.email)}
              </AvatarFallback>
            </Avatar>
            <span className="hidden max-w-48 min-w-0 flex-col text-left leading-tight md:flex">
              <span className="truncate text-sm font-medium">
                {user.email ?? t("myAccount")}
              </span>
              <span className="text-muted-foreground truncate text-xs font-normal">
                {user.role ?? t("myAccount")}
              </span>
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="min-w-56 rounded-lg"
          side="bottom"
          align="end"
          sideOffset={4}
        >
          <UserMenuBody
            user={user}
            onSignOut={() => signOut.current?.requestSubmit()}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
