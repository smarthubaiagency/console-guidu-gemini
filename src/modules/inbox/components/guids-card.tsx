"use client";

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { useStatus } from "@/components/feedback/status-context";
import { KeyValueList } from "@/components/patterns/key-value-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { loadGuidsPanelAction, returnToGuidsAction } from "../guids-actions";
import type { GuidsPanel } from "../server/guids";
import { PanelSection } from "./panel-section";

/**
 * The GUIDS in the context panel (IN6): who answers the pending
 * conversations, the summary of its last handoff in this room (only the
 * team reads it; it never goes to the room) and "Devolver ao GUIDS" for
 * whoever answers. Nothing shows when the Inbox has no GUIDS and the room
 * never had a handoff.
 */
export function GuidsCard({
  workspaceSlug,
  roomId,
  status,
  assignee,
  answers,
  onChanged,
}: Readonly<{
  workspaceSlug: string;
  roomId: string;
  status: string;
  assignee: string | null;
  answers: boolean;
  onChanged: () => void | Promise<void>;
}>) {
  const t = useTranslations("inboxGuids.panel");
  const format = useFormatter();
  const { showStatus } = useStatus();
  const [panel, setPanel] = useState<GuidsPanel | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void loadGuidsPanelAction({ workspaceSlug, roomId }).then((result) => {
      if (live && "panel" in result) setPanel(result.panel);
    });
    return () => {
      live = false;
    };
    // The handoff and the state change together: reload on each change.
  }, [workspaceSlug, roomId, status, assignee]);

  const giveBack = useCallback(async () => {
    setBusy(true);
    try {
      const result = await returnToGuidsAction({ workspaceSlug, roomId });
      if ("error" in result) {
        showStatus({ type: "down", title: result.error });
        return;
      }
      showStatus({ type: "up", title: t("returned") });
      await onChanged();
    } finally {
      setBusy(false);
    }
  }, [workspaceSlug, roomId, showStatus, t, onChanged]);

  if (!panel || (!panel.agent && !panel.handoff)) return null;
  const withGuids =
    panel.agent !== null && status === "pending" && assignee === null;

  return (
    <PanelSection
      value="guids"
      title={t("title")}
      testId="inbox-guids"
      className="space-y-4"
    >
      <KeyValueList
        items={[
          {
            label: t("agent"),
            value: panel.agent ? panel.agent.name : t("none"),
          },
          {
            label: t("now"),
            value: withGuids ? (
              <Badge variant="info">{t("withGuids")}</Badge>
            ) : (
              <Badge variant="neutral">{t("withTeam")}</Badge>
            ),
          },
        ]}
      />
      {panel.handoff ? (
        <div className="space-y-1" data-testid="inbox-guids-summary">
          <p className="text-12 text-text font-medium">{t("summary")}</p>
          <p className="text-12 text-text-secondary whitespace-pre-wrap">
            {panel.handoff.summary}
          </p>
          {panel.handoff.reason ? (
            <p className="text-11 text-text-tertiary">
              {t("reason", { reason: panel.handoff.reason })}
            </p>
          ) : null}
          <p className="text-11 text-text-tertiary">
            {format.dateTime(new Date(panel.handoff.at), {
              dateStyle: "short",
              timeStyle: "short",
            })}
          </p>
        </div>
      ) : null}
      {answers && panel.agent && !withGuids ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void giveBack()}
          data-testid="inbox-guids-return"
        >
          {t("return")}
        </Button>
      ) : null}
    </PanelSection>
  );
}
