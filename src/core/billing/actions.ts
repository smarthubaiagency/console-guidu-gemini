"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { getFormatter, getTranslations } from "next-intl/server";
import { z } from "zod";

import { requireUser } from "@/core/auth/identity";
import { actionFailure } from "@/core/i18n/errors";
import { partnerActor, platformActor } from "@/core/partners/actors";
import type { PartnerActionState } from "@/core/partners/actions";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { getRequestPartner } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError } from "@/shared/errors";

import {
  createPlan,
  publishPlanVersion,
  publishSplitRule,
  refundPayment,
  setCheckoutBlocked,
  setPlanStatus,
} from "./catalog";
import { simulateDemoCheckout } from "./customer";
import { updateBillingTerms } from "./operations";
import {
  changeSubscriptionStatus,
  CheckoutNotReadyError,
  createPartnerPlan,
  recordManualPayment,
  saveBillingProfile,
  setCheckoutEnabled,
  setPartnerPlanStatus,
  PREREQUISITE_KEYS,
  startSubscription,
} from "./partner";
import { parseReais } from "./split";
import { MANUAL_STATUS_TARGETS, statusKey } from "./subscriptions";

/**
 * Server actions of billing (P5m): /platform/billing, /admin/billing and the
 * customer's demonstration checkout. Same result shape as the partner
 * actions, so the forms reuse ActionForm.
 */

type State = PartnerActionState;

/** Success messages of the actions, in the person's language (I3). */
function messages() {
  return getTranslations("billing.actions");
}

/** Reais fields and the `billing.errors.*` key of their message. */
const REAIS_FIELDS = {
  minPrice: { label: "o piso", key: "amountMinPrice" },
  minPlatformShare: { label: "o repasse mínimo", key: "amountMinShare" },
  partnerBasePrice: {
    label: "o valor base do parceiro",
    key: "amountBasePrice",
  },
  price: { label: "o preço", key: "amountPrice" },
  amount: { label: "o valor pago", key: "amountPaid" },
} as const;

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

const uuid = z.string().uuid();

function reais(formData: FormData, key: keyof typeof REAIS_FIELDS): number {
  const cents = parseReais(text(formData, key));
  if (cents === null) {
    const field = REAIS_FIELDS[key];
    throw new AppError({
      code: "invalid_input",
      safeMessage: `Informe ${field.label} em reais, por exemplo 99,90.`,
      messageKey: `billing.errors.${field.key}`,
    });
  }
  return cents;
}

/** `limit.<key>` fields of the plan version form; empty means "default". */
function quotaLimits(formData: FormData): Record<string, number> {
  const limits: Record<string, number> = {};
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith("limit.") || typeof value !== "string") continue;
    const text = value.trim();
    if (!text) continue;
    const number = Number(text);
    if (!Number.isInteger(number) || number < 0) {
      throw new AppError({
        code: "invalid_input",
        safeMessage: "Limites precisam ser números inteiros.",
        messageKey: "billing.errors.limitsInteger",
      });
    }
    limits[name.slice("limit.".length)] = number;
  }
  return limits;
}

// ---------------------------------------------------------------------------
// Platform (/platform/billing)
// ---------------------------------------------------------------------------

async function platformBillingActor() {
  const actor = await platformActor();
  return {
    userId: actor.userId,
    partnerId: actor.partnerId,
    platformRole: actor.role,
  };
}

function inPlatform<T>(
  actor: { userId: string; partnerId: string },
  fn: Parameters<typeof withIdentityContext<T>>[2],
): Promise<T> {
  return withIdentityContext(prisma, actor.userId, fn, {
    partnerId: actor.partnerId,
  });
}

export async function createPlanAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await platformBillingActor();
    await inPlatform(actor, (tx) =>
      createPlan(tx, actor, {
        key: text(formData, "key"),
        name: text(formData, "name"),
      }),
    );
    revalidatePath("/platform/billing");
    const t = await messages();
    return { success: true, message: t("planCreated") };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function publishPlanVersionAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await platformBillingActor();
    const planId = uuid.parse(text(formData, "planId"));
    const { version } = await inPlatform(actor, (tx) =>
      publishPlanVersion(tx, actor, planId, {
        billingInterval:
          text(formData, "billingInterval") === "yearly" ? "yearly" : "monthly",
        moduleKeys: formData
          .getAll("moduleKeys")
          .filter((v): v is string => typeof v === "string"),
        minPriceCents: reais(formData, "minPrice"),
        minPlatformShareCents: reais(formData, "minPlatformShare"),
        partnerBasePriceCents: reais(formData, "partnerBasePrice"),
        provisional: formData.get("provisional") === "on",
        limits: quotaLimits(formData),
      }),
    );
    revalidatePath("/platform/billing");
    const t = await messages();
    return { success: true, message: t("versionPublished", { version }) };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function setPlanStatusAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await platformBillingActor();
    const planId = uuid.parse(text(formData, "planId"));
    const status = z
      .enum(["active", "retired"])
      .parse(text(formData, "status"));
    await inPlatform(actor, (tx) => setPlanStatus(tx, actor, planId, status));
    revalidatePath("/platform/billing");
    const t = await messages();
    return {
      success: true,
      message: t(status === "active" ? "planReactivated" : "planRetired"),
    };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function updateBillingTermsAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await platformBillingActor();
    await inPlatform(actor, (tx) =>
      updateBillingTerms(tx, actor, {
        pastDueAfterDays: text(formData, "pastDueAfterDays"),
        suspendAfterDays: text(formData, "suspendAfterDays"),
        provisional: formData.get("provisional") === "on",
      }),
    );
    revalidatePath("/platform/billing");
    const t = await messages();
    return { success: true, message: t("termsSaved") };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function publishSplitRuleAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await platformBillingActor();
    const partnerId = text(formData, "partnerId");
    const percent = Number(text(formData, "platformPercent").replace(",", "."));
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new AppError({
        code: "invalid_input",
        safeMessage: "Informe um percentual entre 0 e 100.",
        messageKey: "billing.errors.percentRange",
      });
    }
    const { version } = await inPlatform(actor, (tx) =>
      publishSplitRule(tx, actor, {
        partnerId: partnerId ? uuid.parse(partnerId) : null,
        platformPercentBp: Math.round(percent * 100),
      }),
    );
    revalidatePath("/platform/billing");
    const t = await messages();
    return { success: true, message: t("rulePublished", { version }) };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function setCheckoutBlockedAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await platformBillingActor();
    const partnerId = uuid.parse(text(formData, "partnerId"));
    const blocked = text(formData, "blocked") === "true";
    await inPlatform(actor, (tx) =>
      setCheckoutBlocked(tx, actor, partnerId, blocked),
    );
    revalidatePath("/platform/billing");
    const t = await messages();
    return {
      success: true,
      message: t(blocked ? "checkoutBlocked" : "checkoutUnblocked"),
    };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function refundPaymentAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await platformBillingActor();
    const paymentId = uuid.parse(text(formData, "paymentId"));
    const { outcome } = await inPlatform(actor, (tx) =>
      refundPayment(tx, actor, paymentId, text(formData, "reason") || null),
    );
    revalidatePath("/platform/billing");
    const t = await messages();
    return {
      success: true,
      message: t(outcome === "duplicate" ? "alreadyRefunded" : "refunded"),
    };
  } catch (err) {
    return actionFailure(err);
  }
}

// ---------------------------------------------------------------------------
// Partner (/admin/billing)
// ---------------------------------------------------------------------------

function inPartner<T>(
  actor: { userId: string; partnerId: string },
  fn: Parameters<typeof withIdentityContext<T>>[2],
): Promise<T> {
  return withIdentityContext(prisma, actor.userId, fn, {
    partnerId: actor.partnerId,
  });
}

export async function saveBillingProfileAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await partnerActor();
    await inPartner(actor, (tx) =>
      saveBillingProfile(tx, actor, actor.partnerId, {
        legalName: text(formData, "legalName"),
        taxId: text(formData, "taxId"),
        billingEmail: text(formData, "billingEmail"),
      }),
    );
    revalidatePath("/admin/billing");
    const t = await messages();
    return { success: true, message: t("profileSaved") };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function createPartnerPlanAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await partnerActor();
    const priceCents = reais(formData, "price");
    await inPartner(actor, (tx) =>
      createPartnerPlan(tx, actor, actor.partnerId, {
        planId: text(formData, "planId"),
        name: text(formData, "name"),
        priceCents,
      }),
    );
    revalidatePath("/admin/billing");
    const t = await messages();
    const format = await getFormatter();
    return {
      success: true,
      message: t("partnerPlanCreated", {
        price: format.number(priceCents / 100, {
          style: "currency",
          currency: "BRL",
        }),
      }),
    };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function setPartnerPlanStatusAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await partnerActor();
    const partnerPlanId = uuid.parse(text(formData, "partnerPlanId"));
    const status = z
      .enum(["active", "archived"])
      .parse(text(formData, "status"));
    await inPartner(actor, (tx) =>
      setPartnerPlanStatus(tx, actor, actor.partnerId, partnerPlanId, status),
    );
    revalidatePath("/admin/billing");
    const t = await messages();
    return {
      success: true,
      message: t(status === "active" ? "planReactivated" : "planArchived"),
    };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function startSubscriptionAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await partnerActor();
    await inPartner(actor, (tx) =>
      startSubscription(tx, actor, actor.partnerId, {
        organizationId: uuid.parse(text(formData, "organizationId")),
        planId: uuid.parse(text(formData, "planId")),
      }),
    );
    revalidatePath("/admin/billing");
    const t = await messages();
    return { success: true, message: t("subscriptionOpened") };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function recordManualPaymentAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await partnerActor();
    const file = formData.get("evidence");
    const evidence =
      file instanceof File && file.size > 0
        ? new Uint8Array(await file.arrayBuffer())
        : null;
    const result = await inPartner(actor, (tx) =>
      recordManualPayment(tx, actor, actor.partnerId, {
        subscriptionId: text(formData, "subscriptionId"),
        amountCents: reais(formData, "amount"),
        method: text(formData, "method"),
        paidOn: text(formData, "paidOn"),
        note: text(formData, "note") || null,
        evidence,
        idempotencyKey: text(formData, "idempotencyKey") || randomUUID(),
      }),
    );
    revalidatePath("/admin/billing");
    const t = await messages();
    return {
      success: true,
      message: t(
        result.outcome === "duplicate" ? "paymentDuplicate" : "paymentRecorded",
      ),
    };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function changeSubscriptionStatusAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await partnerActor();
    const subscriptionId = uuid.parse(text(formData, "subscriptionId"));
    const to = z.enum(MANUAL_STATUS_TARGETS).parse(text(formData, "to"));
    await inPartner(actor, (tx) =>
      changeSubscriptionStatus(tx, actor, actor.partnerId, subscriptionId, to),
    );
    revalidatePath("/admin/billing");
    const t = await getTranslations("billing");
    return {
      success: true,
      message: t("actions.subscriptionStatus", {
        status: t(`status.${statusKey(to)}`),
      }),
    };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function setCheckoutEnabledAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await partnerActor();
    const enabled = text(formData, "enabled") === "true";
    await inPartner(actor, (tx) =>
      setCheckoutEnabled(tx, actor, actor.partnerId, enabled),
    );
    revalidatePath("/admin/billing");
    const t = await messages();
    return {
      success: true,
      message: t(enabled ? "checkoutEnabled" : "checkoutDisabled"),
    };
  } catch (err) {
    if (err instanceof CheckoutNotReadyError) {
      // The missing prerequisites, named in the person's language.
      const failed = await actionFailure(err);
      const t = await getTranslations("billing");
      const missing = err.missing
        .map((key) =>
          t(`partner.prerequisites.${PREREQUISITE_KEYS[key]}`).toLowerCase(),
        )
        .join("; ");
      return { ...failed, error: t("errors.checkoutMissing", { missing }) };
    }
    return actionFailure(err);
  }
}

// ---------------------------------------------------------------------------
// Customer (/app/[slug]/settings/billing)
// ---------------------------------------------------------------------------

export async function simulateDemoCheckoutAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const identity = await requireUser();
    const partner = await getRequestPartner();
    if (!partner)
      throw new AppError({
        code: "not_found",
        safeMessage: "Checkout indisponível.",
        messageKey: "billing.errors.checkoutUnavailable",
      });
    const workspaceSlug = z
      .string()
      .min(1)
      .parse(text(formData, "workspaceSlug"));
    const context = await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      workspaceSlug,
    );
    const result = await withContext(prisma, context, (tx) =>
      simulateDemoCheckout(
        tx,
        context,
        partner.partnerId,
        uuid.parse(text(formData, "partnerPlanId")),
      ),
    );
    const t = await getTranslations("billing.checkout");
    return {
      success: true,
      message: t("done", { plan: result.planName }),
    };
  } catch (err) {
    return actionFailure(err);
  }
}
