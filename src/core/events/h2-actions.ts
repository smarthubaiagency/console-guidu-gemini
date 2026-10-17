"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { getPlatformAdminMember } from "@/core/admin/platform";
import { requireMfa, requireUser } from "@/core/auth/identity";
import { actionFailure } from "@/core/i18n/errors";
import {
  removeMyWhatsapp,
  saveMyWhatsapp,
} from "@/core/notifications/whatsapp-number";
import type { PartnerActionState } from "@/core/partners/actions";
import { partnerActor } from "@/core/partners/actors";
import type { PlatformAdminRoleKey } from "@/core/permissions/matrix";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { requestClientIp } from "@/core/security/ip-gate";
import type { SettingLevel } from "@/core/settings/catalog";
import type { SettingsActor } from "@/core/settings/service";
import { prisma } from "@/lib/prisma/client";
import {
  type ContextTransaction,
  withContext,
} from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError } from "@/shared/errors";

import {
  type AccessRequester,
  decideEventAccess,
  readEventDataByGrant,
  requestEventAccess,
  revokeEventAccess,
  withdrawEventAccess,
} from "./access";
import { EVENT_CHANNELS, eventDefinition } from "./catalog";
import { platformEventDetail } from "./platform";
import {
  RECIPIENT_PRESETS,
  type Rule,
  RULE_DELIVERIES,
  RULE_EVENT_TYPES,
} from "./rules";
import {
  saveDigestTime,
  saveNotificationRules,
  saveQuietHours,
} from "./rules-service";
import { listPartnerEvents, SETTABLE_STATUSES, setEventStatus } from "./views";
import {
  restoreTemplateDefault,
  saveTemplateVersion,
  type TemplatesActor,
} from "./whatsapp-templates";

/**
 * Server actions of the H2 screens: Eventos at the three levels (status,
 * access to the data), Configurações › Notificações (rules, quiet window,
 * digest, WhatsApp texts) and Minha conta › Meu WhatsApp. Each one checks
 * the actor again (MFA for the consoles); the database repeats every rule.
 * Results go to the SmartStatusBanner.
 */

type State = PartnerActionState & { data?: string };

async function ok(
  key: string,
  values?: Record<string, string>,
): Promise<State> {
  const t = await getTranslations("eventRules.messages");
  return { success: true, message: t(key, values) };
}

const uuid = z.uuid();
const slugSchema = z.string().min(1).max(64);

async function workspaceCtx(slug: string) {
  const identity = await requireUser();
  const ctx = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    slugSchema.parse(slug),
  );
  return { identity, ctx };
}

async function platformRequester() {
  const identity = await requireMfa();
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  return {
    kind: "platform" as const,
    userId: identity.userId,
    platformRole: admin?.status === "active" ? admin.role : null,
  };
}

async function partnerRequester() {
  const actor = await partnerActor();
  return {
    kind: "partner" as const,
    userId: actor.userId,
    partnerId: actor.partnerId,
    partnerRole: actor.partnerRole,
  };
}

function withRequester<T>(
  requester: AccessRequester,
  fn: (tx: ContextTransaction) => Promise<T>,
): Promise<T> {
  return withIdentityContext(
    prisma,
    requester.userId,
    fn,
    requester.kind === "partner" ? { partnerId: requester.partnerId } : {},
  );
}

// ---------------------------------------------------------------------------
// Eventos: status
// ---------------------------------------------------------------------------

const statusInput = z.object({
  eventId: uuid,
  status: z.enum(SETTABLE_STATUSES),
});

export async function setWorkspaceEventStatusAction(
  input: Readonly<{ workspaceSlug: string; eventId: string; status: string }>,
): Promise<State> {
  try {
    const { identity, ctx } = await workspaceCtx(input.workspaceSlug);
    const parsed = statusInput.parse(input);
    await withContext(prisma, ctx, (tx) =>
      setEventStatus(
        tx,
        { userId: identity.userId, ctx },
        parsed.eventId,
        parsed.status,
      ),
    );
    revalidatePath(`/app/${input.workspaceSlug}/events`);
    return ok(`status.${parsed.status}`);
  } catch (err) {
    return actionFailure(err);
  }
}

export async function setConsoleEventStatusAction(
  input: Readonly<{
    level: "platform" | "partner";
    eventId: string;
    status: string;
  }>,
): Promise<State> {
  try {
    const requester =
      input.level === "platform"
        ? await platformRequester()
        : await partnerRequester();
    const parsed = statusInput.parse(input);
    await withRequester(requester, (tx) =>
      setEventStatus(
        tx,
        { userId: requester.userId },
        parsed.eventId,
        parsed.status,
      ),
    );
    revalidatePath(
      input.level === "platform" ? "/platform/events" : "/admin/events",
    );
    return ok(`status.${parsed.status}`);
  } catch (err) {
    return actionFailure(err);
  }
}

// ---------------------------------------------------------------------------
// Access to the data
// ---------------------------------------------------------------------------

const requestInput = z.object({
  level: z.enum(["platform", "partner"]),
  eventId: uuid,
  reason: z.string().max(2000),
  reference: z.string().max(500),
  hours: z.number().int().min(1).max(1000).optional(),
});

/** Asks the customer for the data of an event (from the event's drawer). */
export async function requestEventAccessAction(
  input: Readonly<{
    level: "platform" | "partner";
    eventId: string;
    reason: string;
    reference: string;
    hours?: number;
  }>,
): Promise<State> {
  try {
    const parsed = requestInput.parse(input);
    const requester =
      parsed.level === "platform"
        ? await platformRequester()
        : await partnerRequester();
    await withRequester(requester, async (tx) => {
      let target: { workspaceId: string; organizationId: string } | null = null;
      if (requester.kind === "platform") {
        const detail = await platformEventDetail(
          tx,
          { userId: requester.userId, platformRole: requester.platformRole },
          parsed.eventId,
        );
        if (detail?.workspaceId && detail.organizationId) {
          target = {
            workspaceId: detail.workspaceId,
            organizationId: detail.organizationId,
          };
        }
      } else {
        const rows = await listPartnerEvents(tx, requester.partnerId, {});
        const row = rows.find((r) => r.id === parsed.eventId);
        if (row?.workspaceId && row.organizationId) {
          target = {
            workspaceId: row.workspaceId,
            organizationId: row.organizationId,
          };
        }
      }
      if (!target) {
        throw new AppError({
          code: "not_found",
          safeMessage: "Evento não encontrado.",
          messageKey: "eventRules.errors.eventNotFound",
        });
      }
      return requestEventAccess(tx, requester, {
        ...target,
        eventIds: [parsed.eventId],
        reason: parsed.reason,
        reference: parsed.reference,
        ...(parsed.hours ? { durationHours: parsed.hours } : {}),
      });
    });
    revalidatePath(
      parsed.level === "platform" ? "/platform/events" : "/admin/events",
    );
    return ok("accessRequested");
  } catch (err) {
    return actionFailure(err);
  }
}

/** Reads the data of an event with an approved grant (audited). */
export async function readEventDataByGrantAction(
  input: Readonly<{ level: "platform" | "partner"; eventId: string }>,
): Promise<State> {
  try {
    const requester =
      input.level === "platform"
        ? await platformRequester()
        : await partnerRequester();
    const ip = await requestClientIp();
    const data = await withRequester(requester, (tx) =>
      readEventDataByGrant(tx, requester, { eventId: input.eventId, ip }),
    );
    const result = await ok("dataOpened");
    return { ...result, data: JSON.stringify(data, null, 2) };
  } catch (err) {
    return actionFailure(err);
  }
}

/** The requester withdraws a request or ends a grant. */
export async function withdrawEventAccessAction(
  input: Readonly<{ level: "platform" | "partner"; grantId: string }>,
): Promise<State> {
  try {
    const requester =
      input.level === "platform"
        ? await platformRequester()
        : await partnerRequester();
    await withRequester(requester, (tx) =>
      withdrawEventAccess(tx, requester.userId, input.grantId),
    );
    revalidatePath(
      input.level === "platform" ? "/platform/events" : "/admin/events",
    );
    return ok("accessWithdrawn");
  } catch (err) {
    return actionFailure(err);
  }
}

const decideInput = z.object({
  grantId: uuid,
  decision: z.enum(["approve", "deny"]),
  hours: z.number().int().min(1).max(1000).optional(),
});

/** The owner or an admin of the workspace approves or denies. */
export async function decideEventAccessAction(
  input: Readonly<{
    workspaceSlug: string;
    grantId: string;
    decision: "approve" | "deny";
    hours?: number;
  }>,
): Promise<State> {
  try {
    const { ctx } = await workspaceCtx(input.workspaceSlug);
    const parsed = decideInput.parse(input);
    await withContext(prisma, ctx, (tx) =>
      decideEventAccess(tx, ctx, {
        grantId: parsed.grantId,
        decision: parsed.decision,
        ...(parsed.hours ? { hours: parsed.hours } : {}),
      }),
    );
    revalidatePath(`/app/${input.workspaceSlug}/events`);
    return ok(
      parsed.decision === "approve" ? "accessApproved" : "accessDenied",
    );
  } catch (err) {
    return actionFailure(err);
  }
}

export async function revokeEventAccessAction(
  input: Readonly<{ workspaceSlug: string; grantId: string }>,
): Promise<State> {
  try {
    const { ctx } = await workspaceCtx(input.workspaceSlug);
    await withContext(prisma, ctx, (tx) =>
      revokeEventAccess(tx, ctx, input.grantId),
    );
    revalidatePath(`/app/${input.workspaceSlug}/events`);
    return ok("accessRevoked");
  } catch (err) {
    return actionFailure(err);
  }
}

// ---------------------------------------------------------------------------
// Configurações › Notificações
// ---------------------------------------------------------------------------

async function settingsActorFor(
  level: SettingLevel,
  formData: FormData,
): Promise<{
  actor: SettingsActor;
  run: <T>(fn: (tx: ContextTransaction) => Promise<T>) => Promise<T>;
}> {
  if (level === "platform") {
    const identity = await requireMfa();
    const admin = await getPlatformAdminMember(prisma, identity.userId);
    return {
      actor: {
        level: "platform",
        userId: identity.userId,
        platformRole: admin?.status === "active" ? admin.role : null,
      },
      run: (fn) => withIdentityContext(prisma, identity.userId, fn),
    };
  }
  if (level === "partner") {
    const actor = await partnerActor();
    return {
      actor: {
        level: "partner",
        userId: actor.userId,
        partnerId: actor.partnerId,
        partnerRole: actor.partnerRole,
      },
      run: (fn) =>
        withIdentityContext(prisma, actor.userId, fn, {
          partnerId: actor.partnerId,
        }),
    };
  }
  const { identity, ctx } = await workspaceCtx(
    String(formData.get("workspaceSlug") ?? ""),
  );
  return {
    actor: { level: "workspace", userId: identity.userId, ctx },
    run: (fn) => withContext(prisma, ctx, fn),
  };
}

/** The rules of the form: `rule:<type>:<field>` for each type in `rules:types`. */
export async function readRulesForm(
  formData: FormData,
): Promise<Record<string, Rule>> {
  const types = String(formData.get("rules:types") ?? "")
    .split(",")
    .filter((type) => (RULE_EVENT_TYPES as readonly string[]).includes(type));
  const rules: Record<string, Rule> = {};
  for (const type of types) {
    const definition = eventDefinition(type);
    if (!definition) continue;
    const field = (name: string) => formData.get(`rule:${type}:${name}`);
    const preset = String(field("recipients") ?? "route");
    const escalatePreset = String(field("escalate_to") ?? "");
    const hoursRaw = String(field("escalate_after_hours") ?? "").trim();
    const delivery = String(field("delivery") ?? "immediate");
    const recipients = RECIPIENT_PRESETS[preset];
    const escalateTo = RECIPIENT_PRESETS[escalatePreset];
    const rule: Rule = {
      enabled: field("enabled") === "on",
      channels: EVENT_CHANNELS.filter(
        (channel) => field(`channel:${channel}`) === "on",
      ),
      recipients:
        recipients && recipients !== "route" ? [...recipients] : "route",
      delivery: (RULE_DELIVERIES as readonly string[]).includes(delivery)
        ? (delivery as Rule["delivery"])
        : "immediate",
      ...(definition.approval
        ? {
            escalate_after_hours: hoursRaw
              ? Number.parseInt(hoursRaw, 10) || null
              : null,
            escalate_to:
              escalateTo && escalateTo !== "route" ? [...escalateTo] : [],
          }
        : {}),
      ...(field("locked") === "on" ? { locked: true } : {}),
    };
    rules[type] = rule;
  }
  return rules;
}

function rulesAction(level: SettingLevel) {
  return async (_prev: State, formData: FormData): Promise<State> => {
    try {
      const { actor, run } = await settingsActorFor(level, formData);
      const rules = await readRulesForm(formData);
      await run((tx) => saveNotificationRules(tx, actor, rules));
      revalidatePath("/", "layout");
      return ok("rulesSaved");
    } catch (err) {
      return actionFailure(err);
    }
  };
}

function scheduleAction(level: SettingLevel) {
  return async (_prev: State, formData: FormData): Promise<State> => {
    try {
      const { actor, run } = await settingsActorFor(level, formData);
      const inherit = formData.get("quiet:inherit") === "on";
      const quiet = inherit
        ? null
        : {
            enabled: formData.get("quiet:enabled") === "on",
            start: String(formData.get("quiet:start") ?? ""),
            end: String(formData.get("quiet:end") ?? ""),
            sundays: formData.get("quiet:sundays") === "on",
          };
      const digestRaw = String(formData.get("digest:time") ?? "").trim();
      const digestInherit = formData.get("digest:inherit") === "on";
      await run(async (tx) => {
        await saveQuietHours(
          tx,
          actor,
          quiet,
          level !== "workspace" && formData.get("quiet:locked") === "on",
        );
        await saveDigestTime(
          tx,
          actor,
          digestInherit || !digestRaw ? null : digestRaw,
          level !== "workspace" && formData.get("digest:locked") === "on",
        );
      });
      revalidatePath("/", "layout");
      return ok("scheduleSaved");
    } catch (err) {
      return actionFailure(err);
    }
  };
}

export async function savePlatformNotificationRulesAction(
  prev: State,
  formData: FormData,
) {
  return rulesAction("platform")(prev, formData);
}
export async function savePartnerNotificationRulesAction(
  prev: State,
  formData: FormData,
) {
  return rulesAction("partner")(prev, formData);
}
export async function saveWorkspaceNotificationRulesAction(
  prev: State,
  formData: FormData,
) {
  return rulesAction("workspace")(prev, formData);
}
export async function savePlatformNotificationScheduleAction(
  prev: State,
  formData: FormData,
) {
  return scheduleAction("platform")(prev, formData);
}
export async function savePartnerNotificationScheduleAction(
  prev: State,
  formData: FormData,
) {
  return scheduleAction("partner")(prev, formData);
}
export async function saveWorkspaceNotificationScheduleAction(
  prev: State,
  formData: FormData,
) {
  return scheduleAction("workspace")(prev, formData);
}

async function templatesActor(level: "platform" | "partner"): Promise<{
  actor: TemplatesActor;
  run: <T>(fn: (tx: ContextTransaction) => Promise<T>) => Promise<T>;
}> {
  const { actor, run } = await settingsActorFor(level, new FormData());
  if (actor.level === "platform") {
    return {
      actor: {
        level: "platform",
        userId: actor.userId,
        platformRole: actor.platformRole as PlatformAdminRoleKey | null,
      },
      run,
    };
  }
  if (actor.level === "partner") {
    return {
      actor: {
        level: "partner",
        userId: actor.userId,
        partnerId: actor.partnerId,
        partnerRole: actor.partnerRole,
      },
      run,
    };
  }
  throw new AppError({ code: "forbidden", safeMessage: "Sem permissão." });
}

function templateAction(level: "platform" | "partner") {
  return async (_prev: State, formData: FormData): Promise<State> => {
    try {
      const { actor, run } = await templatesActor(level);
      const eventType = String(formData.get("eventType") ?? "");
      const locale = String(formData.get("locale") ?? "");
      if (formData.get("intent") === "restore") {
        await run((tx) =>
          restoreTemplateDefault(tx, actor, { eventType, locale }),
        );
        revalidatePath("/", "layout");
        return ok("templateRestored");
      }
      const version = await run((tx) =>
        saveTemplateVersion(tx, actor, {
          eventType,
          locale,
          body: String(formData.get("body") ?? ""),
        }),
      );
      revalidatePath("/", "layout");
      return ok("templateSaved", { version: String(version) });
    } catch (err) {
      return actionFailure(err);
    }
  };
}

export async function savePlatformWhatsappTemplateAction(
  prev: State,
  formData: FormData,
) {
  return templateAction("platform")(prev, formData);
}
export async function savePartnerWhatsappTemplateAction(
  prev: State,
  formData: FormData,
) {
  return templateAction("partner")(prev, formData);
}

// ---------------------------------------------------------------------------
// Minha conta › Meu WhatsApp
// ---------------------------------------------------------------------------

export async function saveMyWhatsappAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const identity = await requireUser();
    if (formData.get("intent") === "remove") {
      await withIdentityContext(prisma, identity.userId, (tx) =>
        removeMyWhatsapp(tx, identity.userId),
      );
      revalidatePath("/app/account/notifications");
      return ok("whatsappRemoved");
    }
    await withIdentityContext(prisma, identity.userId, (tx) =>
      saveMyWhatsapp(tx, identity.userId, {
        phone: String(formData.get("phone") ?? ""),
        consent: formData.get("consent") === "on",
      }),
    );
    revalidatePath("/app/account/notifications");
    return ok("whatsappSaved");
  } catch (err) {
    return actionFailure(err);
  }
}
