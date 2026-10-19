"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { PanelImperativeHandle } from "react-resizable-panels";

import { SmartStatusBanner } from "@/components/feedback/smart-status-banner";
import {
  StatusProvider,
  useStatus,
} from "@/components/feedback/status-context";
import type { ShellUser } from "@/components/layout/shell/nav-user";
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
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import type { NavSection } from "@/core/module-runtime/navigation";
import type { NotificationBellData } from "@/core/notifications/bell";
import { useIsMobile } from "@/hooks/use-mobile";

import { changeConversationAction, listConversationsAction } from "../actions";
import { getRoom, unreadCount } from "../client/room-data";
import { useInboxMatrix } from "../client/use-inbox-matrix";
import {
  type ContextTab,
  type ConversationPage,
  INBOX_SIDEBAR_COOKIE,
  type InboxView,
} from "../views";
import { ContextPanel } from "./context-panel";
import { ConversationList } from "./conversation-list";
import { ConversationView } from "./conversation-view";
import { InboxTitleBar, InboxTopBar } from "./inbox-header";
import type { ConversationCommand, InboxViewer } from "./types";

/**
 * The Inbox window (IN4a; ADR 0014, revision of 16/10/2026; layout of the
 * IN4c): two 60px headers (the primary one with search, "Novo", colour
 * mode, notices and the account; the secondary one with the title and the
 * actions of the conversation) over three resizable columns: the list, the
 * conversation and the context panel. The views are chosen in the list;
 * the narrow bar is gone. The button of the primary header (its own
 * cookie, `inbox_sidebar_state`, and Ctrl/⌘+B) folds the list; the one of
 * the secondary header folds the context panel; a folded column renders
 * nothing, so the keyboard never reaches what is out of sight. On a phone
 * the list fills the screen, the conversation stacks over it and the
 * context opens in a sheet.
 */

export type InboxShellProps = Readonly<{
  workspaceSlug: string;
  workspaceName: string;
  viewer: InboxViewer;
  address: string | null;
  defaultOpen: boolean;
  initialView: InboxView;
  initialRoomId: string | null;
  initialTab: ContextTab;
  /** For the search of the primary header (the panel's navigation). */
  sections: readonly NavSection[];
  bell: NotificationBellData;
  user: ShellUser;
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

const REFRESH_MS = 8_000;

function InboxWindow({
  workspaceSlug,
  workspaceName,
  viewer,
  address,
  initialView,
  initialRoomId,
  initialTab,
  sections,
  bell,
  user,
}: InboxShellProps) {
  const t = useTranslations("inbox");
  const { showStatus } = useStatus();
  const isMobile = useIsMobile();
  const { open: listOpen, setOpen: setListOpen } = useSidebar();
  const [view, setView] = useState<InboxView>(initialView);
  const [search, setSearch] = useState("");
  const [labelId, setLabelId] = useState<string | null>(null);
  const [page, setPage] = useState<ConversationPage | null>(null);
  const [selected, setSelected] = useState<string | null>(initialRoomId);
  const [contextOpen, setContextOpen] = useState(false);
  const [contextShown, setContextShown] = useState(true);
  const [tab, setTab] = useState<ContextTab>(initialTab);
  const [busy, setBusy] = useState(false);
  const matrix = useInboxMatrix(viewer.mxid);
  const listPanel = useRef<PanelImperativeHandle | null>(null);
  const contextPanel = useRef<PanelImperativeHandle | null>(null);
  const me = matrix.userId ?? viewer.mxid;

  // The list of the view, from the mirror in the database.
  const refresh = useCallback(async () => {
    const result = await listConversationsAction({
      workspaceSlug,
      view,
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(labelId ? { labelId } : {}),
    });
    if ("page" in result) setPage(result.page);
  }, [workspaceSlug, view, search, labelId]);

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

  // The address bar keeps the view, the open conversation and the tab of
  // the context panel.
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", view);
    if (selected) url.searchParams.set("room", selected);
    else url.searchParams.delete("room");
    if (tab === "contact") url.searchParams.delete("tab");
    else url.searchParams.set("tab", tab);
    window.history.replaceState(null, "", url);
  }, [view, selected, tab]);

  // Ctrl/⌘+B and the button of the primary header fold the list.
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

  // Unread messages of the attendant (Matrix receipts, IN4b), in the tab.
  const unread = useMemo(() => {
    void matrix.revision;
    if (!matrix.client) return 0;
    let total = 0;
    for (const room of matrix.client.getRooms()) {
      if (room.getMyMembership() === "join") total += unreadCount(room, me);
    }
    return total;
  }, [matrix.client, matrix.revision, me]);
  const baseTitle = useRef<string | null>(null);
  useEffect(() => {
    baseTitle.current ??= document.title;
    document.title =
      unread > 0 ? `(${unread}) ${baseTitle.current}` : baseTitle.current;
  }, [unread]);
  useEffect(
    () => () => {
      if (baseTitle.current) document.title = baseTitle.current;
    },
    [],
  );

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
  };

  // A new conversation opens on "Contato".
  const select = (roomId: string | null) => {
    if (roomId !== selected) setTab("contact");
    setSelected(roomId);
  };

  const toggleContext = () => {
    const panel = contextPanel.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand();
    else panel.collapse();
  };

  // "IA" of the secondary header: the GUIDS card, on "Contato".
  const showGuids = () => {
    setTab("contact");
    if (isMobile) setContextOpen(true);
    else if (contextPanel.current?.isCollapsed()) contextPanel.current.expand();
    window.setTimeout(() => {
      document
        .querySelector('[data-testid="inbox-guids"]')
        ?.scrollIntoView({ block: "nearest" });
    }, 50);
  };

  const list = (
    <ConversationList
      view={view}
      onView={choose}
      page={page}
      search={search}
      onSearch={setSearch}
      selected={selected}
      onSelect={select}
      client={matrix.client}
      revision={matrix.revision}
      me={me}
      address={address}
      labelId={labelId}
      onLabel={(next) => {
        setLabelId(next);
        setPage(null);
      }}
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
      onBack={isMobile ? () => select(null) : null}
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
      labels={page?.labels ?? []}
      onChanged={refresh}
      tab={tab}
      onTab={setTab}
    />
  );

  return (
    <main
      className="bg-background flex min-w-0 flex-1 flex-col"
      aria-label={t("windowLabel", { workspace: workspaceName })}
    >
      <InboxTopBar sections={sections} bell={bell} user={user} />
      <InboxTitleBar
        workspaceSlug={workspaceSlug}
        workspaceName={workspaceName}
        manages={viewer.manages}
        hasConversation={selected !== null}
        contextOpen={isMobile ? null : contextShown}
        onToggleContext={toggleContext}
        onShowGuids={showGuids}
      />
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
            {listOpen ? list : null}
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
            collapsible
            panelRef={contextPanel}
            onResize={(size) => {
              const shown = size.asPercentage > 0;
              if (shown !== contextShown) setContextShown(shown);
            }}
          >
            {contextShown ? context : null}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </main>
  );
}
