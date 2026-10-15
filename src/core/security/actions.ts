"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { getPlatformAdminMember } from "@/core/admin/platform";
import { requireMfa, requireUser } from "@/core/auth/identity";
import { actionFailure } from "@/core/i18n/errors";
import type { PartnerActionState } from "@/core/partners/actions";
import { partnerActor } from "@/core/partners/actors";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { saveSettings, type SettingsInput } from "@/core/settings/service";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError } from "@/shared/errors";

import { saveAllowlist } from "./ip-allowlist";
import { requestClientIp } from "./ip-gate";

/**
 * Server actions of Configurações › Segurança (CF5a): the MFA requirement of
 * the workspaces at each level and the IP allow lists of /platform and of
 * the partner's /admin. Each one is audited by its service.
 */

type State = PartnerActionState;

const MFA_KEY = "security.mfa.app";

/** Checked turns the requirement on; unchecked inherits from above. */
function mfaInput(formData: FormData): SettingsInput {
  return {
    values: { [MFA_KEY]: formData.get("mfaApp") === "on" ? true : null },
  };
}

function allowlistText(formData: FormData): string {
  const raw = formData.get("entries");
  return typeof raw === "string" ? raw.slice(0, 4000) : "";
}

async function done(key: "saved" | "allowlistSaved"): Promise<State> {
  const t = await getTranslations("security");
  return { success: true, message: t(`messages.${key}`) };
}

export async function savePlatformSecurityAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const identity = await requireMfa();
    const admin = await getPlatformAdminMember(prisma, identity.userId);
    await withIdentityContext(prisma, identity.userId, (tx) =>
      saveSettings(
        tx,
        {
          level: "platform",
          userId: identity.userId,
          platformRole: admin?.role ?? null,
        },
        mfaInput(formData),
      ),
    );
    revalidatePath("/", "layout");
    return done("saved");
  } catch (err) {
    return actionFailure(err);
  }
}

export async function savePartnerSecurityAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await partnerActor();
    await withIdentityContext(
      prisma,
      actor.userId,
      (tx) =>
        saveSettings(
          tx,
          {
            level: "partner",
            userId: actor.userId,
            partnerId: actor.partnerId,
            partnerRole: actor.partnerRole,
          },
          mfaInput(formData),
        ),
      { partnerId: actor.partnerId },
    );
    revalidatePath("/", "layout");
    return done("saved");
  } catch (err) {
    return actionFailure(err);
  }
}

export async function saveWorkspaceSecurityAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const identity = await requireUser();
    const slug = z.string().min(1).max(64).parse(formData.get("workspaceSlug"));
    const ctx = await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      slug,
    );
    const input = mfaInput(formData);
    // Whoever requires the second factor of the team has it already, so
    // saving never sends the saver out of the workspace by surprise.
    if (input.values[MFA_KEY] === true && !identity.mfaSatisfied) {
      throw new AppError({
        code: "forbidden",
        safeMessage:
          "Ative e confirme a verificação em duas etapas na sua conta antes de exigi-la da equipe.",
        messageKey: "security.errors.enrolFirst",
      });
    }
    await withContext(prisma, ctx, (tx) =>
      saveSettings(
        tx,
        { level: "workspace", userId: identity.userId, ctx },
        input,
      ),
    );
    revalidatePath("/", "layout");
    return done("saved");
  } catch (err) {
    return actionFailure(err);
  }
}

export async function savePlatformAllowlistAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const identity = await requireMfa();
    const admin = await getPlatformAdminMember(prisma, identity.userId);
    const currentIp = await requestClientIp();
    await withIdentityContext(prisma, identity.userId, (tx) =>
      saveAllowlist(
        tx,
        {
          area: "platform",
          userId: identity.userId,
          platformRole: admin?.role ?? null,
        },
        allowlistText(formData),
        currentIp,
      ),
    );
    revalidatePath("/platform/settings/security");
    return done("allowlistSaved");
  } catch (err) {
    return actionFailure(err);
  }
}

export async function savePartnerAllowlistAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await partnerActor();
    const currentIp = await requestClientIp();
    await withIdentityContext(
      prisma,
      actor.userId,
      (tx) =>
        saveAllowlist(
          tx,
          {
            area: "admin",
            userId: actor.userId,
            partnerId: actor.partnerId,
            partnerRole: actor.partnerRole,
          },
          allowlistText(formData),
          currentIp,
        ),
      { partnerId: actor.partnerId },
    );
    revalidatePath("/admin/settings/security");
    return done("allowlistSaved");
  } catch (err) {
    return actionFailure(err);
  }
}
