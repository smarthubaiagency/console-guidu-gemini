import type { Locator, Page } from "@playwright/test";

/**
 * The SmartStatusBanner (ADR 0016) of the page that holds `scope`. Form
 * results show there, not next to the form, so a test that used to look for
 * the message inside a card now passes the card (or the page) here.
 */
export function statusBanner(scope: Page | Locator): Locator {
  const page =
    "page" in scope && typeof scope.page === "function"
      ? (scope as Locator).page()
      : (scope as Page);
  return page.getByTestId("smart-status");
}
