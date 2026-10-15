import type { ProductEvent } from "./privacy";

/**
 * Product events from browser code (CF7): a name only, never a property.
 * The analytics component listens for it; with analytics off, or without
 * consent where it is needed, nothing goes out.
 */
export const PRODUCT_EVENT_NAME = "guidu:analytics";

export function trackProductEvent(name: ProductEvent): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(PRODUCT_EVENT_NAME, { detail: { name } }),
  );
}
