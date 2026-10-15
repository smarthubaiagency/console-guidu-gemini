"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Check, CheckCheck, Settings2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { useStatus } from "@/components/feedback/status-context";
import { Badge } from "@/components/ui/badge";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  markAllNoticesReadAction,
  markNoticeReadAction,
} from "@/core/notifications/actions";
import type { NotificationBellData } from "@/core/notifications/bell";
import { cn } from "@/lib/utils";

/**
 * Bell of the header (CF3c): unread count, the latest notices and "mark as
 * read" (one and all). The notices and labels come written from the server
 * (`loadNotificationBell`); marking shows the result in the SmartStatusBanner
 * (ADR 0016) and refreshes the page data, while the list already shows the
 * change.
 */
export function NotificationBell({
  data,
}: Readonly<{ data: NotificationBellData }>) {
  const tCommon = useTranslations("common");
  const router = useRouter();
  const { showStatus } = useStatus();
  const [pending, startTransition] = useTransition();
  const [readHere, setReadHere] = useState<ReadonlySet<string>>(new Set());
  const [allReadHere, setAllReadHere] = useState(false);

  const notices = data.notices.map((notice) => ({
    ...notice,
    read: notice.read || allReadHere || readHere.has(notice.id),
  }));
  const readNow = data.notices.filter(
    (n) => !n.read && (allReadHere || readHere.has(n.id)),
  ).length;
  const unread = allReadHere ? 0 : Math.max(0, data.unread - readNow);
  const { labels } = data;

  function announce(result: {
    error?: string;
    message?: string;
    requestId?: string;
  }) {
    if (result.error) {
      showStatus({
        type: "down",
        title: result.error,
        ...(result.requestId
          ? {
              message: tCommon("reference", {
                id: result.requestId.slice(0, 8),
              }),
            }
          : {}),
      });
    } else if (result.message) {
      showStatus({ type: "up", title: result.message });
    }
  }

  function markOne(id: string, quiet = false) {
    setReadHere((previous) => new Set(previous).add(id));
    startTransition(async () => {
      const result = await markNoticeReadAction(id);
      if (!quiet || result.error) announce(result);
      router.refresh();
    });
  }

  function markAll() {
    setAllReadHere(true);
    startTransition(async () => {
      const result = await markAllNoticesReadAction();
      announce(result);
      router.refresh();
    });
  }

  const label = unread > 0 ? labels.labelUnread : labels.label;

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        // A fresh list each time the bell opens.
        if (open) router.refresh();
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={label}
              data-testid="notification-bell"
              className="relative"
            >
              <Bell />
              {unread > 0 ? (
                <Badge
                  variant="destructive"
                  data-testid="notification-count"
                  className="pointer-events-none absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 text-[10px] leading-none"
                >
                  {unread > 9 ? "9+" : unread}
                </Badge>
              ) : null}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        className="w-[min(22rem,calc(100vw-2rem))] p-0"
        data-testid="notification-panel"
      >
        <div className="flex items-center justify-between gap-2 p-1 pl-3">
          <DropdownMenuLabel className="p-0 text-sm font-semibold">
            {labels.title}
          </DropdownMenuLabel>
          <DropdownMenuItem
            disabled={pending || unread === 0}
            onSelect={(event) => {
              event.preventDefault();
              markAll();
            }}
            data-testid="notification-mark-all"
          >
            <CheckCheck />
            {labels.markAllRead}
          </DropdownMenuItem>
        </div>
        <DropdownMenuSeparator className="my-0" />
        {notices.length === 0 ? (
          <p
            className="text-muted-foreground px-3 py-6 text-center text-sm"
            data-testid="notification-empty"
          >
            {labels.empty}
          </p>
        ) : (
          <DropdownMenuGroup
            className="max-h-96 overflow-y-auto p-1"
            data-testid="notification-list"
          >
            {notices.map((notice) => {
              const content = (
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span
                    className={cn(
                      "text-sm",
                      notice.read ? "font-normal" : "font-semibold",
                    )}
                  >
                    {notice.title}
                  </span>
                  <span className="text-muted-foreground line-clamp-3 text-xs">
                    {notice.body}
                  </span>
                  <time
                    dateTime={notice.createdAt}
                    className="text-muted-foreground text-xs"
                  >
                    {notice.when}
                  </time>
                </span>
              );
              return (
                <div
                  key={notice.id}
                  className="flex items-start gap-1"
                  data-testid="notification-item"
                  data-read={notice.read ? "true" : "false"}
                >
                  {!notice.read ? (
                    <span
                      aria-hidden
                      className="bg-primary mt-3 ml-1 size-2 shrink-0 rounded-full"
                    />
                  ) : (
                    <span aria-hidden className="ml-1 size-2 shrink-0" />
                  )}
                  {notice.href ? (
                    <DropdownMenuItem asChild className="flex-1 items-start">
                      <a
                        href={notice.href}
                        onClick={() => {
                          if (!notice.read) markOne(notice.id, true);
                        }}
                      >
                        {content}
                      </a>
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      className="flex-1 items-start"
                      onSelect={(event) => {
                        event.preventDefault();
                        if (!notice.read) markOne(notice.id);
                      }}
                    >
                      {content}
                    </DropdownMenuItem>
                  )}
                  {!notice.read ? (
                    <DropdownMenuItem
                      aria-label={labels.markRead}
                      title={labels.markRead}
                      className="mt-1 shrink-0"
                      data-testid="notification-mark-read"
                      onSelect={(event) => {
                        event.preventDefault();
                        markOne(notice.id);
                      }}
                    >
                      <Check />
                    </DropdownMenuItem>
                  ) : null}
                </div>
              );
            })}
          </DropdownMenuGroup>
        )}
        {data.truncated ? (
          <p className="text-muted-foreground px-3 pb-2 text-xs">
            {labels.more}
          </p>
        ) : null}
        <DropdownMenuSeparator className="my-0" />
        <div className="p-1">
          <DropdownMenuItem asChild>
            <Link
              href="/app/account/notifications"
              data-testid="notification-preferences"
            >
              <Settings2 />
              {labels.preferences}
            </Link>
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
