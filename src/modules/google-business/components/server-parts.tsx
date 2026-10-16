import "server-only";

import { cookies } from "next/headers";
import { getFormatter, getTranslations } from "next-intl/server";

import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { appLog } from "@/lib/telemetry/log";

import {
  googleBusinessProvider,
  isGoogleBusinessConfigured,
} from "../provider";
import type { LocationOption } from "../provider/port";
import type { GbAccess } from "../server/access";
import { loadAutomation } from "../server/automation";
import {
  GB_CONNECT_COOKIE,
  openConnectFlow,
  sameTarget,
} from "../server/connect-flow";
import { blockingSteps } from "../server/onboarding";
import { AddLocationWindow, type WindowStep } from "./add-location-window";
import {
  type AutomationPageData,
  presentAutomation,
  type Translator,
} from "./present";

/** Server pieces shared by the `/app` and `/admin` pages (GB1a). */

const STEPS: readonly WindowStep[] = [
  "connect",
  "permissions",
  "denied",
  "failed",
  "choose",
];

export function windowStepOf(value: unknown): WindowStep | null {
  return typeof value === "string" &&
    (STEPS as readonly string[]).includes(value)
    ? (value as WindowStep)
    : null;
}

async function pendingOptions(
  access: GbAccess,
): Promise<readonly LocationOption[] | null> {
  const flow = openConnectFlow((await cookies()).get(GB_CONNECT_COOKIE)?.value);
  if (
    !flow?.pending ||
    flow.userId !== access.ctx.userId ||
    !sameTarget(flow.target, access.target)
  ) {
    return null;
  }
  try {
    return await googleBusinessProvider().listLocations(flow.pending);
  } catch (error) {
    appLog.warn("google_business.list_locations_failed", {
      errorName: error instanceof Error ? error.name : "unknown",
    });
    return null;
  }
}

/** The onboarding window, when the URL asks for it and the person operates. */
export async function AddLocationSlot({
  access,
  step,
  missing,
  closeHref,
}: Readonly<{
  access: GbAccess;
  step: WindowStep | null;
  missing: string | undefined;
  closeHref: string;
}>) {
  if (!step || !access.canManage) return null;
  const t = (await getTranslations()) as unknown as Translator;
  const options = step === "choose" ? await pendingOptions(access) : null;
  return (
    <AddLocationWindow
      target={access.target}
      initialStep={step}
      missing={(missing ?? "").split(",").filter(Boolean).slice(0, 5)}
      options={options}
      configured={isGoogleBusinessConfigured()}
      analysisSteps={blockingSteps().map((s) => ({
        key: s.key,
        label: t.has(s.labelKey) ? t(s.labelKey) : s.key,
      }))}
      closeHref={closeHref}
      workspaceName={access.workspaceName}
    />
  );
}

export async function automationPageData(
  access: GbAccess,
  locationId: string,
): Promise<AutomationPageData> {
  const view = await withContext(prisma, access.ctx, (tx) =>
    loadAutomation(tx, access.ctx, locationId),
  );
  const t = (await getTranslations()) as unknown as Translator;
  const format = await getFormatter();
  return presentAutomation(view, t, (value) =>
    format.number(value, { maximumFractionDigits: 1 }),
  );
}
