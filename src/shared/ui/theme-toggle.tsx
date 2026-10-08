"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

const subscribe = () => () => {};

/** Header control that switches between the light and dark themes. */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // false on the server and during hydration, true afterwards: avoids a
  // mismatch because the stored theme is only known in the browser.
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const isDark = mounted && resolvedTheme === "dark";
  const label = isDark ? "Usar tema claro" : "Usar tema escuro";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={label}
      title={label}
      data-testid="theme-toggle"
      className="border-border bg-surface-raised text-text-secondary hover:border-border-strong hover:text-text flex h-8 w-8 items-center justify-center rounded-lg border transition"
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
