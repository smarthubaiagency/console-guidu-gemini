"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import { getPlatformAdminMember } from "@/core/admin/platform";
import { requireMfa, requireUser } from "@/core/auth/identity";
import { actionFailure } from "@/core/i18n/errors";
import type { PartnerActionState } from "@/core/partners/actions";
import { partnerActor } from "@/core/partners/actors";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { getRequestOrigin } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError } from "@/shared/errors";

import {
  deleteGoogleApp,
  type GoogleAppActor,
  saveGoogleApp,
  saveGoogleScopes,
} from "./apps";
import { disconnectGoogle, startGoogleConnection } from "./connection";
import {
  GOOGLE_FLOW_COOKIE,
  GOOGLE_STATE_TTL_MS,
  sealFlowCookie,
} from "./state";

/**
 * Server actions of Integrações › Google (CF6b): the app and the scopes of
 * the platform (/platform) and of the partner (/admin), and the workspace's
 * connection (/app). Every one checks the identity and the role again.
 */

type State = PartnerActionState;

async function done(key: string): Promise<State> {
  const t = await getTranslations("integrations");
  return { success: true, message: t(key) };
}

function appInput(formData: FormData) {
  return {
    clientId: String(formData.get("clientId") ?? ""),
    clientSecret: String(formData.get("clientSecret") ?? ""),
    verificationStatus: String(formData.get("verificationStatus") ?? ""),
  };
}

const scopesInput = (formData: FormData) =>
  formData.getAll("scopes").map(String);

async function platformGoogleActor(): Promise<GoogleAppActor> {
  const identity = await requireMfa();
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  return {
    level: "platform",
    userId: identity.userId,
    platformRole: admin?.status === "active" ? admin.role : null,
  };
}

async function partnerGoogleActor(): Promise<GoogleAppActor> {
  const actor = await partnerActor();
  return { level: "partner", ...actor };
}

async function inActorContext(
  actor: GoogleAppActor,
  run: Parameters<typeof withIdentityContext>[2],
) {
  return withIdentityContext(prisma, actor.userId, run, {
    partnerId: actor.level === "partner" ? actor.partnerId : null,
  });
}

export async function savePlatformGoogleAppAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await platformGoogleActor();
    await inActorContext(actor, (tx) =>
      saveGoogleApp(tx, actor, appInput(formData)),
    );
    revalidatePath("/platform/settings/integrations/google");
    return done("messages.appSaved");
  } catch (err) {
    return actionFailure(err);
  }
}

export async function savePlatformGoogleScopesAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await platformGoogleActor();
    await inActorContext(actor, (tx) =>
      saveGoogleScopes(tx, actor, scopesInput(formData)),
    );
    revalidatePath("/", "layout");
    return done("messages.scopesSaved");
  } catch (err) {
    return actionFailure(err);
  }
}

export async function savePartnerGoogleAppAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await partnerGoogleActor();
    await inActorContext(actor, (tx) =>
      saveGoogleApp(tx, actor, appInput(formData)),
    );
    revalidatePath("/admin/settings/integrations");
    return done("messages.appSaved");
  } catch (err) {
    return actionFailure(err);
  }
}

export async function deletePartnerGoogleAppAction(): Promise<State> {
  try {
    const actor = await partnerGoogleActor();
    await inActorContext(actor, (tx) => deleteGoogleApp(tx, actor));
    revalidatePath("/admin/settings/integrations");
    return done("messages.appRemoved");
  } catch (err) {
    return actionFailure(err);
  }
}

export async function savePartnerGoogleScopesAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await partnerGoogleActor();
    await inActorContext(actor, (tx) =>
      saveGoogleScopes(tx, actor, scopesInput(formData)),
    );
    revalidatePath("/", "layout");
    return done("messages.scopesSaved");
  } catch (err) {
    return actionFailure(err);
  }
}

function slugOf(formData: FormData): string {
  const slug = String(formData.get("workspaceSlug") ?? "");
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) {
    throw new AppError({
      code: "invalid_input",
      safeMessage: "Workspace inválido.",
      messageKey: "integrations.google.errors.invalid",
    });
  }
  return slug;
}

/**
 * Starts the connection: the consent URL comes back as `redirectTo` (the
 * page navigates to Google) and the PKCE verifier stays in an encrypted,
 * httpOnly cookie of this host for 10 minutes.
 */
export async function connectGoogleAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const identity = await requireUser();
    const workspaceSlug = slugOf(formData);
    const context = await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      workspaceSlug,
    );
    const returnOrigin = await getRequestOrigin();
    if (!returnOrigin) {
      throw new AppError({
        code: "invalid_input",
        safeMessage: "Endereço de retorno não configurado (APP_URL).",
        messageKey: "integrations.google.errors.noRedirect",
      });
    }
    const start = await withContext(prisma, context, (tx) =>
      startGoogleConnection(tx, context, { workspaceSlug, returnOrigin }),
    );
    (await cookies()).set(
      GOOGLE_FLOW_COOKIE,
      sealFlowCookie(start.nonce, start.verifier),
      {
        httpOnly: true,
        sameSite: "lax",
        secure: returnOrigin.startsWith("https://"),
        path: "/",
        maxAge: GOOGLE_STATE_TTL_MS / 1000,
      },
    );
    const t = await getTranslations("integrations");
    return {
      success: true,
      message: t("messages.redirecting"),
      redirectTo: start.url,
    };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function disconnectGoogleAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const identity = await requireUser();
    const workspaceSlug = slugOf(formData);
    const context = await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      workspaceSlug,
    );
    await disconnectGoogle(prisma, context);
    revalidatePath(`/app/${workspaceSlug}/settings/integrations`);
    return done("messages.disconnected");
  } catch (err) {
    return actionFailure(err);
  }
}
