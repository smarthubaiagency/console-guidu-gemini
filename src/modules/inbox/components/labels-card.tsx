"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { useStatus } from "@/components/feedback/status-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Toggle } from "@/components/ui/toggle";

import {
  deleteLabelAction,
  saveLabelAction,
  setRoomLabelAction,
} from "../actions";
import type { LabelColor, LabelView } from "../views";
import { PanelSection } from "./panel-section";
import type { InboxViewer } from "./types";

const COLORS: readonly LabelColor[] = [
  "neutral",
  "info",
  "success",
  "warning",
  "danger",
];

/**
 * Labels of the open conversation (IN4b): who answers puts and takes them;
 * who manages the Inbox also keeps the catalog (new label, delete). Labels
 * live in the database, never in the room: the consumer does not see them.
 */
export function LabelsCard({
  workspaceSlug,
  roomId,
  viewer,
  labels,
  active,
  onChanged,
}: Readonly<{
  workspaceSlug: string;
  roomId: string;
  viewer: InboxViewer;
  labels: readonly LabelView[];
  active: readonly string[];
  onChanged: () => Promise<void>;
}>) {
  const t = useTranslations("inbox");
  const { showStatus, confirmStatus } = useStatus();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<LabelColor>("neutral");
  const answers = viewer.level === "reply";

  const run = async (
    action: () => Promise<{ error: string } | object>,
    done: string | null,
  ) => {
    setBusy(true);
    try {
      const result = await action();
      if ("error" in result) {
        showStatus({ type: "down", title: result.error });
        return false;
      }
      if (done) showStatus({ type: "up", title: done });
      await onChanged();
      return true;
    } finally {
      setBusy(false);
    }
  };

  const remove = async (label: LabelView) => {
    const confirmed = await confirmStatus({
      title: t("labels.confirmDelete", { name: label.name }),
      confirmLabel: t("labels.delete"),
      cancelLabel: t("contact.cancel"),
      tone: "destructive",
    });
    if (!confirmed) return;
    await run(
      () => deleteLabelAction({ workspaceSlug, labelId: label.id }),
      t("labels.deleted"),
    );
  };

  return (
    <PanelSection
      value="labels"
      title={t("labels.title")}
      testId="inbox-labels"
    >
      {labels.length === 0 ? (
        <p className="text-12 text-text-secondary">{t("labels.empty")}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {labels.map((label) => {
            const on = active.includes(label.id);
            return answers ? (
              <span key={label.id} className="inline-flex items-center gap-0.5">
                <Toggle
                  size="sm"
                  variant="outline"
                  pressed={on}
                  disabled={busy}
                  aria-label={label.name}
                  onPressedChange={(pressed) =>
                    void run(
                      () =>
                        setRoomLabelAction({
                          workspaceSlug,
                          roomId,
                          labelId: label.id,
                          on: pressed,
                        }),
                      null,
                    )
                  }
                >
                  <Badge variant={on ? label.color : "neutral"}>
                    {label.name}
                  </Badge>
                </Toggle>
                {viewer.manages ? (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={busy}
                    aria-label={t("labels.deleteNamed", { name: label.name })}
                    onClick={() => void remove(label)}
                  >
                    <X />
                  </Button>
                ) : null}
              </span>
            ) : on ? (
              <Badge key={label.id} variant={label.color}>
                {label.name}
              </Badge>
            ) : null;
          })}
        </div>
      )}
      {viewer.manages ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            void run(
              () => saveLabelAction({ workspaceSlug, name, color }),
              t("labels.created"),
            ).then((ok) => {
              if (ok) setName("");
            });
          }}
        >
          <InputGroup className="flex-1">
            <InputGroupInput
              value={name}
              maxLength={40}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("labels.newPlaceholder")}
              aria-label={t("labels.newPlaceholder")}
            />
          </InputGroup>
          <NativeSelect
            size="sm"
            aria-label={t("labels.color")}
            value={color}
            onChange={(event) => setColor(event.target.value as LabelColor)}
          >
            {COLORS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {t(`labels.colors.${value}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Button
            type="submit"
            size="icon-sm"
            disabled={busy || !name.trim()}
            aria-label={t("labels.add")}
          >
            <Plus />
          </Button>
        </form>
      ) : null}
    </PanelSection>
  );
}
