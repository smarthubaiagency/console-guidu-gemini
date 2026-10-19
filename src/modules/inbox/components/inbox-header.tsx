"use client";

import Link from "next/link";
import {
  Bot,
  CreditCard,
  LayoutDashboard,
  MessageSquarePlus,
  MessagesSquare,
  MoreHorizontal,
  PanelRight,
  Plus,
  Settings,
  StickyNote,
} from "lucide-react";
import { useTranslations } from "next-intl";

import {
  HeaderAction,
  ThemeToggle,
} from "@/components/layout/shell/header-action";
import {
  HeaderUserMenu,
  type ShellUser,
} from "@/components/layout/shell/nav-user";
import { NotificationBell } from "@/components/layout/shell/notification-bell";
import { ShellSearch } from "@/components/layout/shell/shell-search";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarTrigger } from "@/components/ui/sidebar";
import type { NavSection } from "@/core/module-runtime/navigation";
import type { NotificationBellData } from "@/core/notifications/bell";

/**
 * The two 60px headers of the Inbox window (IN4c). The primary one has
 * what every screen of the panel has (search, colour mode, notices and the
 * account), since the Inbox in full screen has no AppShell; the secondary
 * one names the window and holds the actions of the conversation.
 */

/** A header button for what is not there yet: it keeps its tooltip. */
function SoonAction({
  label,
  testId,
  children,
}: Readonly<{ label: string; testId: string; children: React.ReactNode }>) {
  return (
    <HeaderAction
      label={label}
      testId={testId}
      aria-disabled="true"
      className="cursor-not-allowed opacity-50"
      onClick={(event) => event.preventDefault()}
    >
      {children}
    </HeaderAction>
  );
}

export function InboxTopBar({
  sections,
  bell,
  user,
}: Readonly<{
  sections: readonly NavSection[];
  bell: NotificationBellData;
  user: ShellUser;
}>) {
  const t = useTranslations("inbox.header");
  return (
    <header
      data-testid="inbox-top-bar"
      className="border-border flex h-15 shrink-0 items-center gap-2 border-b px-3 md:px-4"
    >
      <div className="flex min-w-0 items-center md:flex-1">
        <SidebarTrigger
          className="-ml-1 hidden md:inline-flex"
          aria-label={t("toggleList")}
          data-testid="inbox-list-toggle"
        />
      </div>
      <div className="flex flex-1 justify-center">
        <ShellSearch sections={sections} />
      </div>
      <div className="flex items-center justify-end gap-1 md:flex-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="hidden md:inline-flex"
              data-testid="inbox-new"
            >
              <Plus />
              {t("new")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
              {t("soon")}
            </DropdownMenuLabel>
            <DropdownMenuItem disabled>
              <MessageSquarePlus />
              {t("newConversation")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              <MessagesSquare />
              {t("newThread")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              <StickyNote />
              {t("newNote")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ThemeToggle />
        <NotificationBell data={bell} />
        <HeaderUserMenu user={user} testId="inbox-user-menu" />
      </div>
    </header>
  );
}

export function InboxTitleBar({
  workspaceSlug,
  workspaceName,
  manages,
  hasConversation,
  contextOpen,
  onToggleContext,
  onShowGuids,
}: Readonly<{
  workspaceSlug: string;
  workspaceName: string;
  manages: boolean;
  hasConversation: boolean;
  /** Null on a phone, where the context opens from the conversation. */
  contextOpen: boolean | null;
  onToggleContext: () => void;
  onShowGuids: () => void;
}>) {
  const t = useTranslations("inbox.header");
  const ti = useTranslations("inbox");
  return (
    <div
      data-testid="inbox-title-bar"
      className="border-border flex h-15 shrink-0 items-center gap-2 border-b px-3 md:px-4"
    >
      <div className="min-w-0 flex-1">
        <h1 className="text-16 text-text truncate leading-tight font-semibold">
          {t("title")}
        </h1>
        <p className="text-12 text-text-tertiary truncate">
          {t("subtitle", { workspace: workspaceName })}
        </p>
      </div>
      <div className="flex items-center gap-1">
        {contextOpen !== null ? (
          <>
            <HeaderAction
              label={t("ai")}
              testId="inbox-ai"
              disabled={!hasConversation}
              onClick={onShowGuids}
            >
              <Bot />
            </HeaderAction>
            <SoonAction label={t("payment")} testId="inbox-payment">
              <CreditCard />
            </SoonAction>
            <HeaderAction
              label={t("toggleContext")}
              testId="inbox-context-toggle"
              aria-pressed={contextOpen}
              onClick={onToggleContext}
            >
              <PanelRight />
            </HeaderAction>
          </>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("options")}
              data-testid="inbox-options"
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            {manages ? (
              <>
                <DropdownMenuItem asChild>
                  <Link href={`/app/${workspaceSlug}/settings/modules/inbox`}>
                    <Settings />
                    {t("settings")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            ) : null}
            <DropdownMenuItem asChild>
              <Link href={`/app/${workspaceSlug}`}>
                <LayoutDashboard />
                {ti("dashboard")}
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
