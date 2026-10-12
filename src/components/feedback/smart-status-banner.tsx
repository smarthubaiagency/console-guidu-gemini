"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Pause,
  Play,
  X,
  XCircle,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

import {
  durationOf,
  isConfirmation,
  type ShownStatus,
  type StatusType,
  useStatus,
} from "./status-context";

type Palette = Readonly<{ badge: string; bar: string; action: string }>;

const PALETTES: Record<StatusType | "destructive", Palette> = {
  up: {
    badge: "bg-success-bg text-success-text",
    bar: "bg-success-solid",
    action: "bg-success-solid text-on-primary hover:bg-success-solid/90",
  },
  oops: {
    badge: "bg-warning-bg text-warning-text",
    bar: "bg-warning-solid",
    action: "bg-warning-solid text-on-warning hover:bg-warning-solid/90",
  },
  down: {
    badge: "bg-danger-bg text-danger-text",
    bar: "bg-danger-solid",
    action: "bg-danger-solid text-on-primary hover:bg-danger-solid/90",
  },
  destructive: {
    badge: "bg-danger-bg text-danger-text",
    bar: "bg-danger-solid",
    action: "bg-danger-solid text-on-primary hover:bg-danger-solid/90",
  },
};

const ICONS: Record<StatusType, typeof CheckCircle2> = {
  up: CheckCircle2,
  oops: AlertTriangle,
  down: XCircle,
};

function BannerCard({ item }: Readonly<{ item: ShownStatus }>) {
  const t = useTranslations("shell");
  const { dismiss, isPaused, pauseTimer, resumeTimer } = useStatus();
  const [expanded, setExpanded] = useState(false);
  const [checked, setChecked] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const messageId = useId();

  const palette = PALETTES[item.tone ?? item.type];
  const Icon = ICONS[item.type];
  const duration = durationOf(item);
  const timed = duration > 0;
  const confirmation = isConfirmation(item);
  const hasDetails = Boolean(item.details);
  const actionDisabled = Boolean(item.checkboxLabel) && !checked;

  // A question takes the focus, so Esc and Tab reach it at once.
  useEffect(() => {
    if (confirmation) card.current?.focus();
  }, [confirmation]);

  const actions =
    item.action || item.secondaryAction ? (
      <div className="flex flex-wrap gap-2">
        {item.secondaryAction ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              item.secondaryAction?.onClick();
            }}
          >
            {item.secondaryAction.label}
          </Button>
        ) : null}
        {item.action ? (
          <Button
            size="sm"
            disabled={actionDisabled}
            className={palette.action}
            data-testid="smart-status-action"
            onClick={(event) => {
              event.stopPropagation();
              if (!actionDisabled) item.action?.onClick();
            }}
          >
            {item.action.label}
          </Button>
        ) : null}
      </div>
    ) : null;

  return (
    <div
      ref={card}
      tabIndex={-1}
      data-testid="smart-status"
      data-type={item.type}
      data-paused={isPaused}
      role={
        confirmation ? "alertdialog" : item.type === "down" ? "alert" : "status"
      }
      aria-live={item.type === "down" ? "assertive" : "polite"}
      aria-labelledby={titleId}
      aria-describedby={item.message ? messageId : undefined}
      onClick={() => {
        if (timed && !isPaused) pauseTimer();
      }}
      className={cn(
        "bg-surface border-border animate-in fade-in slide-in-from-top-2 w-full overflow-hidden rounded-xl border shadow-lg duration-300 outline-none motion-reduce:animate-none",
        timed && !isPaused && "cursor-pointer",
      )}
    >
      <div className="flex gap-3 px-4 pt-4 pb-3">
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full [&_svg]:size-5",
            palette.badge,
          )}
        >
          {item.icon ?? <Icon aria-hidden="true" />}
        </div>

        <Collapsible
          open={expanded}
          onOpenChange={setExpanded}
          className="min-w-0 flex-1"
        >
          <div className="flex items-start justify-between gap-2">
            <p id={titleId} className="text-sm font-semibold">
              {item.title}
            </p>
            <div className="flex shrink-0 items-center gap-1">
              {hasDetails ? (
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 rounded-full"
                    aria-label={
                      expanded ? t("statusHideDetails") : t("statusShowDetails")
                    }
                    onClick={(event) => event.stopPropagation()}
                  >
                    <ChevronDown
                      className={cn(
                        "transition-transform",
                        expanded && "rotate-180",
                      )}
                    />
                  </Button>
                </CollapsibleTrigger>
              ) : null}
              <Button
                variant="ghost"
                size="icon"
                className="size-7 rounded-full"
                aria-label={t("statusClose")}
                data-testid="smart-status-close"
                onClick={(event) => {
                  event.stopPropagation();
                  dismiss();
                }}
              >
                <X />
              </Button>
            </div>
          </div>

          {item.message ? (
            <p id={messageId} className="text-muted-foreground mt-0.5 text-sm">
              {item.message}
            </p>
          ) : null}

          {item.checkboxLabel ? (
            <label
              className="mt-3 flex cursor-pointer items-start gap-2.5 select-none"
              onClick={(event) => event.stopPropagation()}
            >
              <Checkbox
                className="mt-0.5"
                checked={checked}
                onCheckedChange={(value) => setChecked(value === true)}
              />
              <span className="text-xs">{item.checkboxLabel}</span>
            </label>
          ) : null}

          {!hasDetails && actions ? (
            <div className="mt-3">{actions}</div>
          ) : null}

          {hasDetails ? (
            <CollapsibleContent className="data-[state=open]:animate-in data-[state=open]:fade-in">
              <div className="flex flex-col gap-3 pt-3">
                <p className="text-muted-foreground text-sm">{item.details}</p>
                {actions}
              </div>
            </CollapsibleContent>
          ) : null}
        </Collapsible>
      </div>

      {timed ? (
        <>
          <div className="flex items-center justify-between gap-2 px-4 pb-2">
            <span className="text-muted-foreground text-xs">
              {isPaused ? t("statusPaused") : t("statusAutoClose")}
            </span>
            {isPaused ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7"
                data-testid="smart-status-resume"
                onClick={(event) => {
                  event.stopPropagation();
                  resumeTimer();
                }}
              >
                <Play />
                {t("statusResume")}
              </Button>
            ) : (
              <Pause
                className="text-muted-foreground size-3.5"
                aria-hidden="true"
              />
            )}
          </div>
          <div className="h-1 w-full overflow-hidden">
            <div
              data-testid="smart-status-countdown"
              data-paused={isPaused}
              className={cn("status-countdown h-full w-full", palette.bar)}
              style={
                { "--status-duration": `${duration}ms` } as React.CSSProperties
              }
            />
          </div>
        </>
      ) : (
        // Full, still bar: the message waits for the person.
        <div className={cn("h-1 w-full", palette.bar)} />
      )}
    </div>
  );
}

/**
 * SmartStatusBanner (ADR 0016): the feedback card of the dashboard, centred
 * under the 60px header, over the content and its drawers. Mounted once by
 * the shell (`content`) and by the identity pages (`page`, fixed at the top
 * of the window); pages talk to it through `useStatus()`.
 */
export function SmartStatusBanner({
  placement = "content",
}: Readonly<{ placement?: "content" | "page" }>) {
  const { current, dismiss } = useStatus();

  // Esc closes the banner before anything under it (a drawer, ADR 0015).
  useEffect(() => {
    if (!current) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // A dialog or menu open on top (search, a select) closes first.
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[role="dialog"],[role="menu"],[role="listbox"]')) {
        return;
      }
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        dismiss();
      }
    };
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      document.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [current, dismiss]);

  return (
    <div
      className={cn(
        "pointer-events-none inset-x-0 z-50 flex justify-center px-4",
        placement === "content" ? "absolute top-2" : "fixed top-4",
      )}
    >
      <div className="pointer-events-auto w-full max-w-120">
        {current ? <BannerCard key={current.id} item={current} /> : null}
      </div>
    </div>
  );
}
