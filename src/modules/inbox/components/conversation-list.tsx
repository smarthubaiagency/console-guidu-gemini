"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Search } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import type { MatrixClient } from "matrix-js-sdk";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

import {
  getRoom,
  lastMessage,
  memberName,
  unreadCount,
} from "../client/room-data";
import type { ConversationPage, InboxView } from "../views";
import { StatusBadge } from "./status-badge";

/**
 * The list of a view (IN4a): the conversations come from the mirror in the
 * database; the last message and the names come from the attendant's
 * Matrix client, and the list is ordered by the last message.
 */
export function ConversationList({
  view,
  page,
  search,
  onSearch,
  selected,
  onSelect,
  client,
  revision,
  me,
  address,
  labelId,
  onLabel,
}: Readonly<{
  view: InboxView;
  page: ConversationPage | null;
  search: string;
  onSearch: (value: string) => void;
  selected: string | null;
  onSelect: (roomId: string) => void;
  client: MatrixClient | null;
  revision: number;
  me: string | null;
  address: string | null;
  /** Only conversations with this label (IN4b). */
  labelId: string | null;
  onLabel: (labelId: string | null) => void;
}>) {
  const t = useTranslations("inbox");
  const format = useFormatter();
  const labels = useMemo(
    () => new Map((page?.labels ?? []).map((label) => [label.id, label])),
    [page],
  );
  const now = useNow({ updateInterval: 30_000 });

  const rows = useMemo(() => {
    void revision;
    return (page?.items ?? [])
      .map((item) => {
        const room = getRoom(client, item.roomId);
        const last = lastMessage(room);
        return {
          ...item,
          name:
            item.consumerName ??
            memberName(room, item.consumerMxid) ??
            t("unknownContact"),
          assigneeName:
            item.assignee === me
              ? t("you")
              : (memberName(room, item.assignee) ?? null),
          last,
          ts: last?.ts ?? Date.parse(item.updatedAt),
          unread: unreadCount(room, me),
        };
      })
      .sort((a, b) => b.ts - a.ts);
  }, [page, client, revision, me, t]);

  return (
    <section
      className="flex h-full min-h-0 flex-col"
      aria-label={t("listLabel")}
      data-testid="inbox-list"
    >
      <header className="border-border flex h-15 shrink-0 items-center gap-2 border-b px-3">
        <SidebarTrigger className="hidden md:inline-flex" />
        <h1 className="text-14 text-text font-semibold">
          {t(`views.${view}`)}
        </h1>
        {page ? (
          <Badge variant="neutral" data-testid="inbox-count">
            {page.counts[view]}
          </Badge>
        ) : null}
      </header>
      <div className="border-border space-y-2 border-b p-3">
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
          />
        </InputGroup>
        {labels.size > 0 ? (
          <NativeSelect
            size="sm"
            className="w-full"
            aria-label={t("labels.filter")}
            value={labelId ?? ""}
            onChange={(event) => onLabel(event.target.value || null)}
          >
            <NativeSelectOption value="">{t("labels.all")}</NativeSelectOption>
            {[...labels.values()].map((label) => (
              <NativeSelectOption key={label.id} value={label.id}>
                {label.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        ) : null}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {page === null ? (
          <div className="space-y-3 p-3" aria-busy="true">
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="rounded-inner h-14 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyList view={view} search={search} address={address} />
        ) : (
          <ul className="divide-border divide-y" role="list">
            {rows.map((row) => (
              <li key={row.roomId}>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onSelect(row.roomId)}
                  aria-current={row.roomId === selected ? "true" : undefined}
                  data-room-id={row.roomId}
                  className={cn(
                    "hover:bg-surface-hover h-auto w-full flex-col items-stretch gap-1 rounded-none px-4 py-3 text-left font-normal whitespace-normal",
                    row.roomId === selected && "bg-surface-inset",
                  )}
                >
                  <span className="flex w-full items-center gap-2">
                    <span className="text-14 text-text truncate font-medium">
                      {row.name}
                    </span>
                    <span className="text-11 text-text-tertiary ml-auto shrink-0">
                      {format.relativeTime(row.ts, now)}
                    </span>
                    {row.unread > 0 ? (
                      <Badge
                        variant="info"
                        aria-label={t("unread", { count: row.unread })}
                        data-testid="inbox-unread"
                      >
                        {row.unread}
                      </Badge>
                    ) : null}
                  </span>
                  <span className="text-12 text-text-secondary line-clamp-1">
                    {row.last?.body ?? t("noMessages")}
                  </span>
                  <span className="flex items-center gap-2">
                    <StatusBadge status={row.status} />
                    <span className="text-11 text-text-tertiary truncate">
                      {row.assigneeName
                        ? t("assignedTo", { name: row.assigneeName })
                        : row.assignee
                          ? t("assigned")
                          : t("unassigned")}
                    </span>
                  </span>
                  {row.labelIds.length > 0 ? (
                    <span className="flex flex-wrap gap-1">
                      {row.labelIds.flatMap((id) => {
                        const label = labels.get(id);
                        return label
                          ? [
                              <Badge key={id} variant={label.color}>
                                {label.name}
                              </Badge>,
                            ]
                          : [];
                      })}
                    </span>
                  ) : null}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </section>
  );
}

function EmptyList({
  view,
  search,
  address,
}: Readonly<{ view: InboxView; search: string; address: string | null }>) {
  const t = useTranslations("inbox");
  const [copied, setCopied] = useState(false);
  return (
    <Empty className="p-6" data-testid="inbox-empty">
      <EmptyHeader>
        <EmptyTitle>
          {search ? t("empty.searchTitle") : t(`empty.${view}`)}
        </EmptyTitle>
        <EmptyDescription>{t("empty.description")}</EmptyDescription>
      </EmptyHeader>
      {address ? (
        <EmptyContent>
          <p className="text-12 text-text-secondary">{t("addressHint")}</p>
          <div className="flex w-full items-center gap-2">
            <code
              className="bg-surface-inset rounded-inner text-11 min-w-0 flex-1 truncate px-2 py-1.5"
              data-testid="inbox-address"
            >
              {address}
            </code>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={t("copyAddress")}
              onClick={() => {
                void navigator.clipboard?.writeText(address);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? <Check /> : <Copy />}
            </Button>
          </div>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}
