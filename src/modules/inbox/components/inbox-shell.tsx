"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  CheckCheck,
  Inbox,
  LayoutDashboard,
  MessagesSquare,
  UserRound,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { PanelImperativeHandle } from "react-resizable-panels";

import { SmartStatusBanner } from "@/components/feedback/smart-status-banner";
import {
  StatusProvider,
  useStatus,
} from "@/components/feedback/status-context";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";

import { changeConversationAction, listConversationsAction } from "../actions";
import { getRoom } from "../client/room-data";
import { useInboxMatrix } from "../client/use-inbox-matrix";
import {
  type ConversationPage,
  INBOX_SIDEBAR_COOKIE,
  type InboxView,
} from "../views";
import { ContextPanel } from "./context-panel";
import { ConversationList } from "./conversation-list";
import { ConversationView } from "./conversation-view";
import type { ConversationCommand, InboxViewer } from "./types";

/**
 * The Inbox window (IN4a; ADR 0014, revision of 16/10/2026): the narrow bar
 * of the `sidebar-09` block with the views and one way back to the
 * dashboard, and three resizable columns: the list, the conversation and
 * the context panel. Collapsing the bar (its own cookie,
 * `inbox_sidebar_state`, and Ctrl/⌘+B) folds the list, as in the block.
 * On a phone the list fills the screen, the conversation stacks over it
 * and the context opens in a sheet.
 */

export type InboxShellProps = Readonly<{
  workspaceSlug: string;
  workspaceName: string;
  viewer: InboxViewer;
  address: string | null;
  defaultOpen: boolean;
  initialView: InboxView;
  initialRoomId: string | null;
}>;

export function InboxShell(props: InboxShellProps) {
  return (
    <StatusProvider>
      <SidebarProvider
        cookieName={INBOX_SIDEBAR_COOKIE}
        defaultOpen={props.defaultOpen}
        className="h-dvh min-h-0 overflow-hidden"
      >
        <InboxWindow {...props} />
      </SidebarProvider>
      <SmartStatusBanner />
    </StatusProvider>
  );
}

const VIEW_ICONS = {
  mine: UserRound,
  unassigned: Inbox,
  all: MessagesSquare,
  resolved: CheckCheck,
} as const;

const VIEWS: readonly InboxView[] = ["mine", "unassigned", "all", "resolved"];

const REFRESH_MS = 8_000;

function InboxWindow({
  workspaceSlug,
  workspaceName,
  viewer,
  address,
  initialView,
  initialRoomId,
}: InboxShellProps) {
  const t = useTranslations("inbox");
  const { showStatus } = useStatus();
  const isMobile = useIsMobile();
  const { open: listOpen, setOpen: setListOpen } = useSidebar();
  const [view, setView] = useState<InboxView>(initialView);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState<ConversationPage | null>(null);
  const [selected, setSelected] = useState<string | null>(initialRoomId);
  const [contextOpen, setContextOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const matrix = useInboxMatrix(viewer.mxid);
  const listPanel = useRef<PanelImperativeHandle | null>(null);
  const me = matrix.userId ?? viewer.mxid;

  // The list of the view, from the mirror in the database.
  const refresh = useCallback(async () => {
    const result = await listConversationsAction({
      workspaceSlug,
      view,
      ...(search.trim() ? { search: search.trim() } : {}),
    });
    if ("page" in result) setPage(result.page);
  }, [workspaceSlug, view, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), search ? 250 : 0);
    const interval = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [refresh, search]);

  // The open room is a subscription of the Sliding Sync.
  const { open } = matrix;
  useEffect(() => {
    open(selected);
  }, [open, selected, matrix.client]);

  // The address bar keeps the view and the open conversation.
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", view);
    if (selected) url.searchParams.set("room", selected);
    else url.searchParams.delete("room");
    window.history.replaceState(null, "", url);
  }, [view, selected]);

  // Ctrl/⌘+B and the bar fold the list (sidebar-09).
  useEffect(() => {
    const panel = listPanel.current;
    if (!panel || isMobile) return;
    if (listOpen && panel.isCollapsed()) panel.expand();
    if (!listOpen && !panel.isCollapsed()) panel.collapse();
  }, [listOpen, isMobile]);

  const summary = useMemo(
    () => page?.items.find((item) => item.roomId === selected) ?? null,
    [page, selected],
  );
  const room = getRoom(matrix.client, selected);

  const run = useCallback(
    async (command: ConversationCommand) => {
      if (!selected) return;
      setBusy(true);
      try {
        const result = await changeConversationAction({
          workspaceSlug,
          roomId: selected,
          action: command,
        });
        if ("error" in result) {
          showStatus({ type: "down", title: result.error });
          return;
        }
        showStatus({ type: "up", title: t(`done.${command.kind}`) });
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [selected, workspaceSlug, showStatus, t, refresh],
  );

  const choose = (next: InboxView) => {
    setView(next);
    setPage(null);
    if (!listOpen) setListOpen(true);
  };

  const list = (
    <ConversationList
      view={view}
      page={page}
      search={search}
      onSearch={setSearch}
      selected={selected}
      onSelect={setSelected}
      client={matrix.client}
      revision={matrix.revision}
      me={me}
      address={address}
    />
  );
  const conversation = (
    <ConversationView
      roomId={selected}
      room={room}
      client={matrix.client}
      phase={matrix.phase}
      revision={matrix.revision}
      me={me}
      viewer={viewer}
      summary={summary}
      onBack={isMobile ? () => setSelected(null) : null}
      onShowContext={isMobile ? () => setContextOpen(true) : null}
    />
  );
  const context = (
    <ContextPanel
      workspaceSlug={workspaceSlug}
      roomId={selected}
      room={room}
      summary={summary}
      viewer={viewer}
      me={me}
      busy={busy}
      revision={matrix.revision}
      onCommand={run}
      onChanged={refresh}
    />
  );

  return (
    <>
      <Sidebar
        collapsible="none"
        className="w-12! border-r"
        aria-label={t("viewsLabel")}
        data-testid="inbox-views"
      >
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent className="px-0">
              <SidebarMenu>
                {VIEWS.map((key) => {
                  const Icon = VIEW_ICONS[key];
                  const count = page?.counts[key] ?? 0;
                  return (
                    <SidebarMenuItem key={key}>
                      <SidebarMenuButton
                        tooltip={{ children: t(`views.${key}`), hidden: false }}
                        isActive={view === key}
                        onClick={() => choose(key)}
                        aria-label={t(`views.${key}`)}
                        className="px-2"
                      >
                        <Icon />
                        <span className="sr-only">{t(`views.${key}`)}</span>
                      </SidebarMenuButton>
                      {count > 0 && key !== "resolved" ? (
                        <SidebarMenuBadge className="sr-only">
                          {count}
                        </SidebarMenuBadge>
                      ) : null}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                tooltip={{ children: t("dashboard"), hidden: false }}
                className="px-2"
              >
                <Link
                  href={`/app/${workspaceSlug}`}
                  aria-label={t("dashboard")}
                >
                  <LayoutDashboard />
                  <span className="sr-only">{t("dashboard")}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <main
        className="bg-background flex min-w-0 flex-1 flex-col"
        aria-label={t("windowLabel", { workspace: workspaceName })}
      >
        {isMobile ? (
          <div className="relative min-h-0 flex-1">
            {selected ? conversation : list}
            <Sheet open={contextOpen} onOpenChange={setContextOpen}>
              <SheetContent side="right" className="w-11/12 p-0">
                <SheetHeader className="sr-only">
                  <SheetTitle>{t("context.title")}</SheetTitle>
                </SheetHeader>
                {context}
              </SheetContent>
            </Sheet>
          </div>
        ) : (
          <ResizablePanelGroup orientation="horizontal" className="min-h-0">
            <ResizablePanel
              id="inbox-panel-list"
              defaultSize="28"
              minSize="18"
              collapsible
              panelRef={listPanel}
              onResize={(size) => {
                const collapsed = size.asPercentage === 0;
                if (collapsed === listOpen) setListOpen(!collapsed);
              }}
            >
              {list}
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel
              id="inbox-panel-conversation"
              defaultSize="48"
              minSize="30"
            >
              {conversation}
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel
              id="inbox-panel-context"
              defaultSize="24"
              minSize="16"
            >
              {context}
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </main>
    </>
  );
}
