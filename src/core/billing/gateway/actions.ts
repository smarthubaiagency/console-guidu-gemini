"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import { appOrigin } from "@/core/auth/origin";
import { actionFailure } from "@/core/i18n/errors";
import type { PartnerActionState } from "@/core/partners/actions";
import { platformActor } from "@/core/partners/actors";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { appLog } from "@/lib/telemetry/log";
import { AppError } from "@/shared/errors";

import {
  auditTestWebhook,
  loadTestWebhookSecret,
  reprocessFailedEvents,
  saveStripeCredentials,
  saveStripeSettings,
} from "./service";
import { buildTestEvent, isGatewayMode, STRIPE_WEBHOOK_PATH } from "./stripe";
import { signStripePayload, STRIPE_SIGNATURE_HEADER } from "./stripe-signature";

/**
 * Server actions of Cobrança › Gateway (CF7). The actor is revalidated on
 * every call (AAL2, platform host, IP list); the services check the billing
 * role again and RLS repeats it.
 */

type State = PartnerActionState;

const PAGE = "/platform/billing/gateway";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function gatewayActor() {
  const actor = await platformActor();
  return {
    userId: actor.userId,
    partnerId: actor.partnerId,
    platformRole: actor.role,
  };
}

type Actor = Awaited<ReturnType<typeof gatewayActor>>;

function inPlatform<T>(
  actor: Actor,
  fn: Parameters<typeof withIdentityContext<T>>[2],
): Promise<T> {
  return withIdentityContext(prisma, actor.userId, fn, {
    partnerId: actor.partnerId,
  });
}

export async function saveStripeSettingsAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await gatewayActor();
    const mode = text(formData, "mode");
    if (!isGatewayMode(mode)) {
      throw new AppError({
        code: "invalid_input",
        safeMessage: "Escolha o modo.",
        messageKey: "gateway.errors.mode",
      });
    }
    await inPlatform(actor, (tx) =>
      saveStripeSettings(tx, actor, {
        enabled: formData.get("enabled") === "on",
        isDefault: formData.get("isDefault") === "on",
        mode,
      }),
    );
    revalidatePath(PAGE);
    const t = await getTranslations("gateway.messages");
    return { success: true, message: t("settingsSaved") };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function saveStripeCredentialsAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await gatewayActor();
    await inPlatform(actor, (tx) =>
      saveStripeCredentials(tx, actor, {
        secretKey: text(formData, "secretKey") || null,
        webhookSecret: text(formData, "webhookSecret") || null,
      }),
    );
    revalidatePath(PAGE);
    const t = await getTranslations("gateway.messages");
    return { success: true, message: t("credentialsSaved") };
  } catch (err) {
    return actionFailure(err);
  }
}

/**
 * "Enviar webhook de teste": an event with no data, signed here with the
 * saved signing secret and posted to the webhook route through APP_URL, so
 * it checks the address, the signature and the storage end to end.
 */
export async function sendStripeTestWebhookAction(): Promise<State> {
  try {
    const actor = await gatewayActor();
    const { secret, mode } = await inPlatform(actor, (tx) =>
      loadTestWebhookSecret(tx, actor),
    );
    const body = buildTestEvent(mode);
    let delivered = false;
    try {
      const response = await fetch(`${appOrigin()}${STRIPE_WEBHOOK_PATH}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [STRIPE_SIGNATURE_HEADER]: signStripePayload(body, secret),
        },
        body,
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      delivered = response.status === 200;
      await response.body?.cancel().catch(() => undefined);
    } catch (error) {
      appLog.warn("billing.stripe_webhook.test_failed", {
        error: error instanceof Error ? error.name : "unknown",
      });
    }
    await inPlatform(actor, (tx) => auditTestWebhook(tx, actor, delivered));
    revalidatePath(PAGE);
    const t = await getTranslations("gateway.messages");
    if (!delivered) {
      return { success: false, error: t("testFailed") };
    }
    return { success: true, message: t("testSent") };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function reprocessStripeWebhooksAction(): Promise<State> {
  try {
    const actor = await gatewayActor();
    const result = await inPlatform(actor, (tx) =>
      reprocessFailedEvents(tx, actor),
    );
    revalidatePath(PAGE);
    const t = await getTranslations("gateway.messages");
    return {
      success: true,
      message: t("reprocessed", {
        processed: result.processed,
        failed: result.failed,
      }),
    };
  } catch (err) {
    return actionFailure(err);
  }
}
