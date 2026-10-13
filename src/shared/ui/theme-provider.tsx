"use client";

import type { ReactNode } from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Light/dark theme for the design system. Writes `data-theme` on <html>, which
 * switches every token in globals.css. Follows the OS setting until the user
 * picks a theme in the account menu of the sidebar (ADR 0014).
 */
export function ThemeProvider({
  children,
  nonce,
}: Readonly<{ children: ReactNode; nonce?: string | undefined }>) {
  return (
    <NextThemesProvider
      {...(nonce ? { nonce } : {})}
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
