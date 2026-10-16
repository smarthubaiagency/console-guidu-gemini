import { z } from "zod";

/**
 * Where a Google Business action runs (GB1a): the `/app` of a workspace
 * (the customer operates, mode `padrao`) or the `/admin` of the partner
 * that manages the company (mode `gerenciado`). Serializable, so screens
 * pass it to server actions; the server resolves it again every time.
 */
export const GbTargetSchema = z.discriminatedUnion("scope", [
  z.strictObject({
    scope: z.literal("app"),
    workspaceSlug: z.string().min(1).max(64),
  }),
  z.strictObject({ scope: z.literal("admin"), workspaceId: z.uuid() }),
]);

export type GbTarget = z.infer<typeof GbTargetSchema>;

/** Page of the module where the onboarding window opens. */
export function onboardingPath(target: GbTarget): string {
  return target.scope === "app"
    ? `/app/${encodeURIComponent(target.workspaceSlug)}/google-business`
    : `/admin/customers?workspace=${encodeURIComponent(target.workspaceId)}`;
}

/** The automation page of a ficha. */
export function automationPath(target: GbTarget, locationId: string): string {
  return target.scope === "app"
    ? `/app/${encodeURIComponent(target.workspaceSlug)}/google-business/locations/${locationId}`
    : `/admin/customers/workspaces/${target.workspaceId}/locations/${locationId}`;
}

/** The onboarding page with the window open at a step. */
export function windowPath(
  target: GbTarget,
  step: string,
  extra: Readonly<Record<string, string>> = {},
): string {
  const base = onboardingPath(target);
  const url = new URL(base, "http://x");
  url.searchParams.set("addLocation", step);
  for (const [key, value] of Object.entries(extra)) {
    url.searchParams.set(key, value);
  }
  return `${url.pathname}${url.search}`;
}
