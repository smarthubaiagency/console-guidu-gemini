"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { requireUser } from "@/core/auth/identity";
import { actionFailure } from "@/core/i18n/errors";
import { partnerActor, platformActor } from "@/core/partners/actors";
import type { PartnerActionState } from "@/core/partners/actions";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { getRequestOrigin, getRequestPartner } from "@/core/partners/resolve";
import { Permissions } from "@/core/permissions/catalog";
import {
  hasPartnerRolePermission,
  hasPlatformRolePermission,
} from "@/core/permissions/matrix";
import { requestClientIp } from "@/core/security/ip-gate";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { withPartnerContext } from "@/lib/prisma/with-partner-context";

import {
  type DecisionOutcome,
  SERVICE_MODE_DECISIONS,
  serviceModeFailure,
} from "./requests";
import {
  cancelManagedModeRequest,
  decideByToken,
  decideInApp,
  requestManagedMode,
  revertToStandard,
} from "./service";

/**
 * Server actions of the service modes (GB1c): the partner console and the
 * platform ask and cancel; the owner decides by the secure link or in
 * /app and goes back to `padrao`. Each one checks again who acts; the
 * database functions and RLS repeat it.
 */

export type ServiceModeActionState = PartnerActionState;

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

const uuid = z.uuid();
const decisionSchema = z.enum(SERVICE_MODE_DECISIONS);
const t = () => getTranslations("serviceMode");

async function decisionMeta() {
  const requestHeaders = await headers();
  let ip: string | null = null;
  try {
    ip = await requestClientIp();
  } catch {
    ip = null;
  }
  return {
    ip,
    userAgent: requestHeaders.get("user-agent")?.slice(0, 500) ?? null,
  };
}

async function outcomeState(
  outcome: DecisionOutcome,
): Promise<ServiceModeActionState> {
  const messages = await t();
  switch (outcome) {
    case "approved":
      return { success: true, message: messages("results.approved") };
    case "denied":
      return { success: true, message: messages("results.denied") };
    case "expired":
      return { error: messages("results.expired"), code: "conflict" };
    case "already_decided":
      return { error: messages("results.alreadyDecided"), code: "conflict" };
    case "not_found":
      return { error: messages("results.notFound"), code: "not_found" };
  }
}

// ---------------------------------------------------------------------------
// Partner console (/admin › Clientes)
// ---------------------------------------------------------------------------

async function requestingPartner() {
  const actor = await partnerActor();
  if (
    !actor.partnerRole ||
    !hasPartnerRolePermission(
      actor.partnerRole,
      Permissions.PARTNER_SERVICE_MODE_REQUEST,
    )
  ) {
    throw serviceModeFailure("forbidden");
  }
  return actor;
}

export async function requestManagedModePartnerAction(
  _prev: ServiceModeActionState,
  formData: FormData,
): Promise<ServiceModeActionState> {
  try {
    const actor = await requestingPartner();
    const organizationId = uuid.parse(text(formData, "organizationId"));
    const origin = (await getRequestOrigin()) ?? "";
    await withIdentityContext(
      prisma,
      actor.userId,
      (tx) =>
        requestManagedMode(
          tx,
          { userId: actor.userId, via: "partner" },
          organizationId,
          origin,
        ),
      { partnerId: actor.partnerId },
    );
    revalidatePath("/admin/customers");
    return { success: true, message: (await t())("results.requested") };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function cancelManagedModePartnerAction(
  _prev: ServiceModeActionState,
  formData: FormData,
): Promise<ServiceModeActionState> {
  try {
    const actor = await requestingPartner();
    const requestId = uuid.parse(text(formData, "requestId"));
    await withIdentityContext(
      prisma,
      actor.userId,
      (tx) =>
        cancelManagedModeRequest(
          tx,
          { userId: actor.userId, via: "partner" },
          requestId,
        ),
      { partnerId: actor.partnerId },
    );
    revalidatePath("/admin/customers");
    return { success: true, message: (await t())("results.cancelled") };
  } catch (err) {
    return actionFailure(err);
  }
}

// ---------------------------------------------------------------------------
// Platform console (/platform › Clientes): direct customers (partner zero)
// ---------------------------------------------------------------------------

async function requestingPlatform() {
  const actor = await platformActor();
  if (
    !actor.role ||
    !hasPlatformRolePermission(
      actor.role,
      Permissions.PLATFORM_SERVICE_MODE_REQUEST,
    )
  ) {
    throw serviceModeFailure("forbidden");
  }
  return actor;
}

export async function requestManagedModePlatformAction(
  _prev: ServiceModeActionState,
  formData: FormData,
): Promise<ServiceModeActionState> {
  try {
    const actor = await requestingPlatform();
    const organizationId = uuid.parse(text(formData, "organizationId"));
    const origin = (await getRequestOrigin()) ?? "";
    await withIdentityContext(
      prisma,
      actor.userId,
      (tx) =>
        requestManagedMode(
          tx,
          { userId: actor.userId, via: "platform" },
          organizationId,
          origin,
        ),
      { partnerId: actor.partnerId },
    );
    revalidatePath("/platform/customers");
    return { success: true, message: (await t())("results.requested") };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function cancelManagedModePlatformAction(
  _prev: ServiceModeActionState,
  formData: FormData,
): Promise<ServiceModeActionState> {
  try {
    const actor = await requestingPlatform();
    const requestId = uuid.parse(text(formData, "requestId"));
    await withIdentityContext(
      prisma,
      actor.userId,
      (tx) =>
        cancelManagedModeRequest(
          tx,
          { userId: actor.userId, via: "platform" },
          requestId,
        ),
      { partnerId: actor.partnerId },
    );
    revalidatePath("/platform/customers");
    return { success: true, message: (await t())("results.cancelled") };
  } catch (err) {
    return actionFailure(err);
  }
}

// ---------------------------------------------------------------------------
// Secure link (public page, the host's partner, no session needed)
// ---------------------------------------------------------------------------

export async function decideServiceModeLinkAction(
  _prev: ServiceModeActionState,
  formData: FormData,
): Promise<ServiceModeActionState> {
  try {
    const token = text(formData, "token");
    const decision = decisionSchema.parse(text(formData, "decision"));
    const partner = await getRequestPartner();
    if (!partner) throw serviceModeFailure("not_found");
    const meta = await decisionMeta();
    const origin = (await getRequestOrigin()) ?? "";
    const outcome = await withPartnerContext(prisma, partner.partnerId, (tx) =>
      decideByToken(tx, token, decision, meta, origin),
    );
    revalidatePath(`/service-mode/${token}`);
    return outcomeState(outcome);
  } catch (err) {
    return actionFailure(err);
  }
}

// ---------------------------------------------------------------------------
// /app › Configurações › Modo de serviço (the company owner)
// ---------------------------------------------------------------------------

async function ownerContext(formData: FormData) {
  const identity = await requireUser();
  const workspaceSlug = text(formData, "workspaceSlug");
  const ctx = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );
  return { ctx, workspaceSlug };
}

export async function decideServiceModeAppAction(
  _prev: ServiceModeActionState,
  formData: FormData,
): Promise<ServiceModeActionState> {
  try {
    const { ctx, workspaceSlug } = await ownerContext(formData);
    const requestId = uuid.parse(text(formData, "requestId"));
    const decision = decisionSchema.parse(text(formData, "decision"));
    const meta = await decisionMeta();
    const origin = (await getRequestOrigin()) ?? "";
    const outcome = await withContext(prisma, ctx, (tx) =>
      decideInApp(tx, ctx, requestId, decision, meta, origin),
    );
    revalidatePath(`/app/${workspaceSlug}/settings/service-mode`);
    return outcomeState(outcome);
  } catch (err) {
    return actionFailure(err);
  }
}

export async function revertServiceModeAction(
  _prev: ServiceModeActionState,
  formData: FormData,
): Promise<ServiceModeActionState> {
  try {
    const { ctx, workspaceSlug } = await ownerContext(formData);
    const origin = (await getRequestOrigin()) ?? "";
    await withContext(prisma, ctx, (tx) =>
      revertToStandard(tx, ctx, workspaceSlug, origin),
    );
    revalidatePath(`/app/${workspaceSlug}/settings/service-mode`);
    return { success: true, message: (await t())("results.reverted") };
  } catch (err) {
    return actionFailure(err);
  }
}
