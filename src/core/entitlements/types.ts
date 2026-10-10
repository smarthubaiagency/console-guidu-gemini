import type { SubscriptionStatus } from "@/core/billing/subscriptions";

/**
 * The plan contract of a company (F3b, decision 3 of the F3 plan), read for
 * every member through `private.organization_contract`:
 * - `legacy`: no subscription at all; modules and limits work as before.
 * - `subscribed`: the open subscription, or the latest canceled one.
 */
export type CompanyContract =
  | Readonly<{ kind: "legacy" }>
  | Readonly<{
      kind: "subscribed";
      status: SubscriptionStatus;
      planName: string;
      planVersion: number;
      moduleKeys: readonly string[];
      limits: Readonly<Record<string, number>>;
      provisional: boolean;
    }>;

export const LEGACY_CONTRACT: CompanyContract = { kind: "legacy" };
