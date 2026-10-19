"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const subscribe = () => () => {};

/** Icon button of a 60px header (ADR 0014), with its label as tooltip. */
export function HeaderAction({
  label,
  testId,
  children,
  ...props
}: Readonly<{
  label: string;
  testId: string;
  children: React.ReactNode;
}> &
  Omit<React.ComponentProps<typeof Button>, "children">) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          data-testid={testId}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Light and dark mode switch of the headers (ADR 0014). */
export function ThemeToggle() {
  const tu = useTranslations("ui");
  const { resolvedTheme, setTheme } = useTheme();
  // The stored theme is only known in the browser: false while hydrating.
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const isDark = mounted && resolvedTheme === "dark";
  return (
    <HeaderAction
      label={isDark ? tu("themeLight") : tu("themeDark")}
      testId="theme-toggle"
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun /> : <Moon />}
    </HeaderAction>
  );
}
