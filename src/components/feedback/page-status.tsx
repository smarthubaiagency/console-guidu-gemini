import type { ReactNode } from "react";

import { SmartStatusBanner } from "./smart-status-banner";
import { StatusProvider } from "./status-context";

/**
 * Feedback of a page outside the dashboard shell (auth pages, workspace
 * picker, account pages): the same SmartStatusBanner (ADR 0016), fixed at the
 * top of the window.
 */
export function PageStatus({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <StatusProvider>
      <SmartStatusBanner placement="page" />
      {children}
    </StatusProvider>
  );
}
