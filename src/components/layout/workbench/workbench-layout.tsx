"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PanelLeft } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export type WorkbenchPanelSize = "default" | "wide";

export type WorkbenchState = Readonly<{
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  panelSize: WorkbenchPanelSize;
  setPanelSize: (size: WorkbenchPanelSize) => void;
}>;

const WorkbenchContext = createContext<WorkbenchState | null>(null);

/** Opens, closes and resizes the drawer from anywhere inside the layout. */
export function useWorkbench(): WorkbenchState {
  const state = useContext(WorkbenchContext);
  if (!state) throw new Error("useWorkbench must be used in WorkbenchLayout");
  return state;
}

/** Controlled when `value` is given, uncontrolled otherwise. */
export function useControllable<T>(
  value: T | undefined,
  initial: T,
  onChange: ((next: T) => void) | undefined,
): [T, (next: T) => void] {
  const [inner, setInner] = useState(initial);
  const current = value === undefined ? inner : value;
  const set = useCallback(
    (next: T) => {
      if (value === undefined) setInner(next);
      onChange?.(next);
    },
    [value, onChange],
  );
  return [current, set];
}

/**
 * The internal drawer itself (ADR 0015): `absolute` on the right of the
 * nearest `relative` parent, never `fixed`. 350px or 700px from `lg` up, the
 * whole parent width below. Esc closes it, also when the focus is outside it
 * (a menu or dialog open on top closes first); the focus goes into it on open
 * and back to the opener on close. Reads its state from the nearest
 * workbench.
 */
export function WorkbenchDrawer({
  label,
  children,
}: Readonly<{ label: string; children: React.ReactNode }>) {
  const { panelOpen: open, setPanelOpen, panelSize: size } = useWorkbench();
  const drawer = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    // A drawer already open on the first paint does not take the focus.
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (open) {
      if (document.activeElement instanceof HTMLElement) {
        opener.current = document.activeElement;
      }
      drawer.current?.focus();
    } else {
      opener.current?.focus();
      opener.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Esc pressed outside the drawer, e.g. after a save moved the focus to
    // the page. Radix layers mark the event when they close first.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        setPanelOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, setPanelOpen]);

  if (!open) return null;
  return (
    <aside
      ref={drawer}
      tabIndex={-1}
      aria-label={label}
      data-slot="workbench-panel"
      data-size={size}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.stopPropagation();
          setPanelOpen(false);
        }
      }}
      className={cn(
        "bg-surface border-border absolute top-0 right-0 z-40 flex h-full w-full max-w-full flex-col border-l shadow-xl outline-none",
        "transition-all duration-500 ease-in-out motion-reduce:transition-none",
        size === "wide" ? "lg:w-drawer-wide" : "lg:w-drawer",
      )}
    >
      {children}
    </aside>
  );
}

/** Drawer state for content outside a WorkbenchLayout (the shell assistant). */
export function WorkbenchProvider({
  value,
  children,
}: Readonly<{ value: WorkbenchState; children: React.ReactNode }>) {
  return (
    <WorkbenchContext.Provider value={value}>
      {children}
    </WorkbenchContext.Provider>
  );
}

export type WorkbenchLayoutProps = Readonly<{
  /** Context column (list, filters); a drawer of its own below `lg`. */
  left?: React.ReactNode;
  leftLabel?: string;
  /** Canvas: the page content. */
  main: React.ReactNode;
  /** Content of the internal drawer: an edit form or an assistant chat. */
  panel: React.ReactNode;
  panelLabel: string;
  panelOpen?: boolean;
  defaultPanelOpen?: boolean;
  onPanelOpenChange?: (open: boolean) => void;
  panelSize?: WorkbenchPanelSize;
  defaultPanelSize?: WorkbenchPanelSize;
  onPanelSizeChange?: (size: WorkbenchPanelSize) => void;
}>;

/**
 * Edit and chat window of the project (ADR 0015), after the legacy
 * AiWorkbenchLayout: an internal drawer, not a modal.
 *
 * - The drawer is `absolute` inside the content (`relative`), anchored on the
 *   right with a local z-index: it never covers the sidebar or the header.
 * - Default width (350px) pushes the content; wide (700px) grows to the left
 *   over it. Below `lg` the drawer takes the whole content width.
 * - Esc closes it; focus goes into the drawer and back to the opener.
 */
export function WorkbenchLayout({
  left,
  leftLabel,
  main,
  panel,
  panelLabel,
  panelOpen,
  defaultPanelOpen = false,
  onPanelOpenChange,
  panelSize,
  defaultPanelSize = "default",
  onPanelSizeChange,
}: WorkbenchLayoutProps) {
  const t = useTranslations("shell");
  const [open, setOpen] = useControllable(
    panelOpen,
    defaultPanelOpen,
    onPanelOpenChange,
  );
  const [size, setSize] = useControllable(
    panelSize,
    defaultPanelSize,
    onPanelSizeChange,
  );
  // Left column as a drawer below `lg`; it gives way to the panel.
  const [listOpen, setListOpen] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setListOpen(false);
  }
  const state = useMemo(
    () => ({
      panelOpen: open,
      setPanelOpen: setOpen,
      panelSize: size,
      setPanelSize: setSize,
    }),
    [open, setOpen, size, setSize],
  );

  return (
    <WorkbenchContext.Provider value={state}>
      <div
        data-slot="workbench"
        className="h-workbench md:h-workbench-md -m-4 flex overflow-hidden md:-m-6"
      >
        {left ? (
          <aside
            aria-label={leftLabel}
            className="border-border w-drawer hidden shrink-0 overflow-y-auto border-r lg:block"
          >
            {left}
          </aside>
        ) : null}

        <section className="relative min-w-0 flex-1 overflow-hidden">
          <div
            data-slot="workbench-main"
            className={cn(
              "h-full overflow-y-auto transition-all duration-500 ease-in-out motion-reduce:transition-none",
              open && size === "default" && "lg:pr-drawer",
            )}
          >
            {left ? (
              <div className="px-4 pt-4 lg:hidden">
                <Sheet open={listOpen} onOpenChange={setListOpen}>
                  <SheetTrigger asChild>
                    <Button variant="outline" size="sm">
                      <PanelLeft />
                      {leftLabel ?? t("workbenchList")}
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="left" className="w-drawer p-0">
                    <SheetHeader>
                      <SheetTitle>{leftLabel ?? t("workbenchList")}</SheetTitle>
                    </SheetHeader>
                    <div className="overflow-y-auto">{left}</div>
                  </SheetContent>
                </Sheet>
              </div>
            ) : null}
            {main}
          </div>

          <WorkbenchDrawer label={panelLabel}>{panel}</WorkbenchDrawer>
        </section>
      </div>
    </WorkbenchContext.Provider>
  );
}
