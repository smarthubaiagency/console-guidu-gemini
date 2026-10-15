"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import { getPlatformAdminMember } from "@/core/admin/platform";
import { requireMfa } from "@/core/auth/identity";
import { actionFailure } from "@/core/i18n/errors";
import type { PartnerActionState } from "@/core/partners/actions";
import { partnerActor } from "@/core/partners/actors";
import { effectiveSettings, saveSettings } from "@/core/settings/service";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError } from "@/shared/errors";

import {
  ANALYTICS_PROVIDERS,
  type AnalyticsProvider,
  isValidSiteId,
  POSTHOG_REGIONS,
  type PosthogRegion,
} from "./config";
import { clearAnalyticsCache } from "./values";

/**
 * Server actions of Configurações › Analytics (CF7). Saving goes through
 * the settings cascade, which audits each change (`platform.settings.save`,
 * `partner.settings.save`); the site identifier is checked against the
 * provider here. A save clears the cached values, so the CSP and the
 * browser configuration follow at once.
 */

type State = PartnerActionState;

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function invalid(key: string, message: string): AppError {
  return new AppError({
    code: "invalid_input",
    safeMessage: message,
    messageKey: `analytics.errors.${key}`,
  });
}

/** Plausible takes the site's domain (lowercase); PostHog its `phc_` key. */
function siteIdFor(provider: AnalyticsProvider, raw: string): string | null {
  if (!raw) return null;
  const value = provider === "plausible" ? raw.toLowerCase() : raw;
  if (!isValidSiteId(provider, value)) {
    throw provider === "plausible"
      ? invalid("plausibleSite", "Informe o domínio do site no Plausible.")
      : invalid("posthogKey", "Informe a chave do projeto no PostHog (phc_).");
  }
  return value;
}

async function saved(): Promise<State> {
  clearAnalyticsCache();
  revalidatePath("/", "layout");
  const t = await getTranslations("analytics.messages");
  return { success: true, message: t("saved") };
}

export async function savePlatformAnalyticsAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const identity = await requireMfa();
    const provider = text(formData, "provider");
    const region = text(formData, "region") || "us";
    if (
      !(ANALYTICS_PROVIDERS as readonly string[]).includes(provider) ||
      !(POSTHOG_REGIONS as readonly string[]).includes(region)
    ) {
      throw invalid("provider", "Escolha o provedor.");
    }
    const enabled = formData.get("enabled") === "on";
    const siteId = siteIdFor(
      provider as AnalyticsProvider,
      text(formData, "siteId"),
    );
    if (enabled && !siteId) {
      throw invalid("siteRequired", "Informe o identificador antes de ligar.");
    }
    const admin = await getPlatformAdminMember(prisma, identity.userId);
    await withIdentityContext(prisma, identity.userId, (tx) =>
      saveSettings(
        tx,
        {
          level: "platform",
          userId: identity.userId,
          platformRole: admin?.status === "active" ? admin.role : null,
        },
        {
          values: {
            "analytics.enabled": enabled,
            "analytics.provider": provider as AnalyticsProvider,
            "analytics.site_id": siteId,
            "analytics.posthog_region": region as PosthogRegion,
          },
        },
      ),
    );
    return saved();
  } catch (err) {
    return actionFailure(err);
  }
}

export async function savePartnerAnalyticsAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await partnerActor();
    const enabled = formData.get("enabled") === "on";
    await withIdentityContext(
      prisma,
      actor.userId,
      async (tx) => {
        // The identifier follows the provider the platform chose.
        const provider = (await effectiveSettings(tx)).values[
          "analytics.provider"
        ];
        const siteId = siteIdFor(provider, text(formData, "siteId"));
        if (enabled && !siteId) {
          throw invalid(
            "siteRequired",
            "Informe o identificador antes de ligar.",
          );
        }
        await saveSettings(
          tx,
          {
            level: "partner",
            userId: actor.userId,
            partnerId: actor.partnerId,
            partnerRole: actor.partnerRole,
          },
          {
            values: {
              "analytics.partner_enabled": enabled,
              "analytics.partner_site_id": siteId,
            },
          },
        );
      },
      { partnerId: actor.partnerId },
    );
    return saved();
  } catch (err) {
    return actionFailure(err);
  }
}
