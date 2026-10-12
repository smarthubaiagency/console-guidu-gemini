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

/** up = success, oops = warning, down = error. */
export type StatusType = "up" | "oops" | "down";

export type StatusAction = Readonly<{ label: string; onClick: () => void }>;

export type StatusItem = Readonly<{
  type: StatusType;
  title: string;
  /** Subtitle, always visible. */
  message?: string;
  /** Longer text behind a chevron; the buttons move into it. */
  details?: string;
  /** Main button, in the colour of the status. */
  action?: StatusAction;
  /** Ghost button beside the main one. */
  secondaryAction?: StatusAction;
  /** Checkbox that must be ticked before the main button works. */
  checkboxLabel?: string;
  /** "destructive" paints the icon and the main button as danger. */
  tone?: "destructive";
  /** Replaces the icon of the type. */
  icon?: React.ReactNode;
  /** Milliseconds on screen; 0 stays until the person closes it. */
  duration?: number;
}>;

export type ShownStatus = StatusItem & Readonly<{ id: number }>;

export type ConfirmOptions = Readonly<{
  title: string;
  message?: string;
  details?: string;
  checkboxLabel?: string;
  confirmLabel: string;
  cancelLabel: string;
  type?: StatusType;
  tone?: "destructive";
}>;

export type StatusContextValue = Readonly<{
  current: ShownStatus | null;
  /** Shows a message in place of the current one (a pending confirmation
   *  keeps the screen; the message waits for its answer). */
  showStatus: (item: StatusItem) => void;
  /** Asks a question in the banner; resolves true on confirm, false on
   *  cancel, close or Esc. Replaces `confirm()`. */
  confirmStatus: (options: ConfirmOptions) => Promise<boolean>;
  dismiss: () => void;
  pauseTimer: () => void;
  resumeTimer: () => void;
  isPaused: boolean;
}>;

export const DEFAULT_STATUS_DURATION = 4000;

const StatusContext = createContext<StatusContextValue | null>(null);

/** Feedback of the dashboard (ADR 0016): a single message at a time. */
export function useStatus(): StatusContextValue {
  const value = useContext(StatusContext);
  if (!value) {
    throw new Error("useStatus must be used inside StatusProvider (shell)");
  }
  return value;
}

export function durationOf(item: StatusItem): number {
  return item.duration ?? DEFAULT_STATUS_DURATION;
}

/** A confirmation waits for an answer: no timer and a main action. */
export function isConfirmation(item: StatusItem): boolean {
  return durationOf(item) <= 0 && Boolean(item.action);
}

/**
 * State of the SmartStatusBanner (ADR 0016). The timer keeps the time left
 * across a pause, so resuming continues where it stopped, and every message
 * gets its own id, so the same message twice animates again.
 */
export function StatusProvider({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [current, setCurrent] = useState<ShownStatus | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const nextId = useRef(1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef(0);
  const remaining = useRef(0);
  // Message that arrived while a confirmation was open.
  const deferred = useRef<StatusItem | null>(null);
  // Answer of the open confirmation, if any.
  const answer = useRef<((confirmed: boolean) => void) | null>(null);
  const currentRef = useRef<ShownStatus | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const show = useCallback(
    (item: StatusItem) => {
      clearTimer();
      const shown = { ...item, id: nextId.current++ };
      currentRef.current = shown;
      setCurrent(shown);
      setIsPaused(false);
      remaining.current = durationOf(item);
    },
    [clearTimer],
  );

  const dismiss = useCallback(() => {
    clearTimer();
    const resolve = answer.current;
    answer.current = null;
    resolve?.(false);
    const next = deferred.current;
    deferred.current = null;
    if (next) {
      show(next);
    } else {
      currentRef.current = null;
      setCurrent(null);
      setIsPaused(false);
    }
  }, [clearTimer, show]);

  // Starts the countdown of each new message and closes it at the end.
  useEffect(() => {
    if (!current || isPaused || remaining.current <= 0) return;
    startedAt.current = Date.now();
    timer.current = setTimeout(dismiss, remaining.current);
    return clearTimer;
  }, [current, isPaused, dismiss, clearTimer]);

  const showStatus = useCallback(
    (item: StatusItem) => {
      const open = currentRef.current;
      if (open && isConfirmation(open) && !isConfirmation(item)) {
        deferred.current = item;
        return;
      }
      answer.current?.(false);
      answer.current = null;
      show(item);
    },
    [show],
  );

  const confirmStatus = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        answer.current?.(false);
        const settle = (confirmed: boolean) => {
          answer.current = null;
          resolve(confirmed);
          dismiss();
        };
        answer.current = resolve;
        show({
          type: options.type ?? "oops",
          title: options.title,
          duration: 0,
          action: { label: options.confirmLabel, onClick: () => settle(true) },
          secondaryAction: {
            label: options.cancelLabel,
            onClick: () => settle(false),
          },
          ...(options.message ? { message: options.message } : {}),
          ...(options.details ? { details: options.details } : {}),
          ...(options.checkboxLabel
            ? { checkboxLabel: options.checkboxLabel }
            : {}),
          ...(options.tone ? { tone: options.tone } : {}),
        });
      }),
    [dismiss, show],
  );

  const pauseTimer = useCallback(() => {
    if (!timer.current) return;
    clearTimer();
    remaining.current = Math.max(
      0,
      remaining.current - (Date.now() - startedAt.current),
    );
    setIsPaused(true);
  }, [clearTimer]);

  const resumeTimer = useCallback(() => setIsPaused(false), []);

  useEffect(() => clearTimer, [clearTimer]);

  const value = useMemo(
    () => ({
      current,
      showStatus,
      confirmStatus,
      dismiss,
      pauseTimer,
      resumeTimer,
      isPaused,
    }),
    [
      current,
      showStatus,
      confirmStatus,
      dismiss,
      pauseTimer,
      resumeTimer,
      isPaused,
    ],
  );

  return (
    <StatusContext.Provider value={value}>{children}</StatusContext.Provider>
  );
}
