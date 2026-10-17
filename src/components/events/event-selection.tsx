"use client";

import { KeyRound, X } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { AccessRequestForm } from "./event-actions";

/**
 * Access to the data of several events at once (AJ1): the Eventos lists of
 * /admin and /platform tick events of one customer's workspace and send one
 * request (reason, reference and term) through the same form and action
 * as the drawer. Ticking an event of another workspace is disabled until
 * the selection is cleared; at most `max` events (the table's limit).
 */

type Selection = Readonly<{
  workspaceId: string | null;
  workspaceLabel: string;
  ids: readonly string[];
}>;

type SelectionContext = Readonly<{
  selection: Selection;
  max: number;
  toggle: (eventId: string, workspaceId: string, label: string) => void;
  clear: () => void;
}>;

const EMPTY: Selection = { workspaceId: null, workspaceLabel: "", ids: [] };

const Context = createContext<SelectionContext | null>(null);

export function EventSelectionProvider({
  max,
  children,
}: Readonly<{ max: number; children: ReactNode }>) {
  const [selection, setSelection] = useState<Selection>(EMPTY);
  const value = useMemo<SelectionContext>(
    () => ({
      selection,
      max,
      toggle(eventId, workspaceId, label) {
        setSelection((current) => {
          if (current.ids.includes(eventId)) {
            const ids = current.ids.filter((id) => id !== eventId);
            return ids.length === 0 ? EMPTY : { ...current, ids };
          }
          if (current.workspaceId && current.workspaceId !== workspaceId) {
            return current;
          }
          if (current.ids.length >= max) return current;
          return {
            workspaceId,
            workspaceLabel: label,
            ids: [...current.ids, eventId],
          };
        });
      },
      clear() {
        setSelection(EMPTY);
      },
    }),
    [selection, max],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

function useSelection(): SelectionContext {
  const context = useContext(Context);
  if (!context) throw new Error("EventSelectionProvider missing");
  return context;
}

/** The tick of one row; disabled for another workspace or past the limit. */
export function EventSelectCheckbox({
  eventId,
  workspaceId,
  workspaceLabel,
}: Readonly<{
  eventId: string;
  workspaceId: string;
  workspaceLabel: string;
}>) {
  const t = useTranslations("eventRules.access");
  const { selection, max, toggle } = useSelection();
  const checked = selection.ids.includes(eventId);
  const otherWorkspace =
    selection.workspaceId !== null && selection.workspaceId !== workspaceId;
  const full = !checked && selection.ids.length >= max;
  return (
    <Checkbox
      checked={checked}
      disabled={otherWorkspace || full}
      onCheckedChange={() => toggle(eventId, workspaceId, workspaceLabel)}
      aria-label={t("selectEvent")}
      title={otherWorkspace ? t("selectOtherWorkspace") : t("selectEvent")}
      data-testid="event-select"
      className="mt-3 shrink-0"
    />
  );
}

/** Count, clear and the request of the ticked events. */
export function EventSelectionBar({
  level,
}: Readonly<{ level: "platform" | "partner" }>) {
  const t = useTranslations("eventRules.access");
  const { selection, max, clear } = useSelection();
  const [open, setOpen] = useState(false);
  const count = selection.ids.length;
  return (
    <Card
      variant="surface"
      className="flex flex-row flex-wrap items-center gap-2 px-4 sm:px-6"
      data-testid="event-selection-bar"
    >
      <p className="text-12 text-text-secondary min-w-0 flex-1">
        {count === 0
          ? t("selectHint", { max })
          : t("selected", { count, workspace: selection.workspaceLabel })}
      </p>
      {count > 0 ? (
        <>
          <Button type="button" size="sm" variant="outline" onClick={clear}>
            <X />
            {t("clearSelection")}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => setOpen(true)}
            data-testid="event-selection-request"
          >
            <KeyRound />
            {t("requestSelected")}
          </Button>
        </>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("requestManyTitle", { count })}</DialogTitle>
          </DialogHeader>
          {open ? (
            <AccessRequestForm
              level={level}
              eventIds={selection.ids}
              startOpen
              onDone={(sent) => {
                setOpen(false);
                if (sent) clear();
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
