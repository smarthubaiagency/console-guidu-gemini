"use client";

import type { ReactNode } from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Light/dark theme for the design system. Writes `data-theme` on <html>, which
 * switches every token in globals.css. Follows the OS setting until the user
 * picks a theme with <ThemeToggle />.
 */
export function ThemeProvider({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
