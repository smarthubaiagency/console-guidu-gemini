"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { getPlatformAdminMember } from "@/core/admin/platform";
import { requireMfa, requireUser } from "@/core/auth/identity";
import type { PartnerActionState } from "@/core/partners/actions";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { toSafeError } from "@/shared/errors";

import {
  addLanguage,
  type LanguageActor,
  resetText,
  saveText,
  setUserLocale,
  setWorkspaceLocale,
  updateLanguage,
} from "./service";

/** Server actions of the language screens (I1). */

type State = PartnerActionState;

function failure(err: unknown): State {
  const safe = toSafeError(err);
  return {
    error: safe.safeMessage,
    code: safe.code,
    requestId: safe.requestId,
  };
}

function str(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  const text = typeof value === "string" ? value.trim() : "";
  return text.length ? text : undefined;
}

/** Platform screens need an internal role and AAL2, revalidated here. */
async function platformActor(): Promise<LanguageActor> {
  const identity = await requireMfa();
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  return {
    userId: identity.userId,
    platformRole: admin?.status === "active" ? admin.role : null,
  };
}

const runAsActor = <T>(
  actor: LanguageActor,
  fn: Parameters<typeof withIdentityContext<T>>[2],
) => withIdentityContext(prisma, actor.userId, fn);

export async function addLanguageAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await platformActor();
    await runAsActor(actor, (tx) =>
      addLanguage(tx, actor, {
        code: str(formData, "code") ?? "",
        name: str(formData, "name") ?? "",
      }),
    );
    revalidatePath("/platform/settings/languages");
    return {
      success: true,
      message: (await getTranslations("languages"))("added"),
    };
  } catch (err) {
    return failure(err);
  }
}

export async function updateLanguageAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await platformActor();
    const code = str(formData, "code") ?? "";
    const op = str(formData, "op");
    const input =
      op === "default"
        ? { is_default: true }
        : op === "activate"
          ? { status: "active" }
          : op === "deactivate"
            ? { status: "disabled" }
            : { name: str(formData, "name") ?? "" };
    await runAsActor(actor, (tx) => updateLanguage(tx, actor, code, input));
    revalidatePath("/platform/settings/languages");
    revalidatePath("/", "layout");
    return {
      success: true,
      message: (await getTranslations("languages"))("saved"),
    };
  } catch (err) {
    return failure(err);
  }
}

export async function saveTextAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const actor = await platformActor();
    const code = str(formData, "code") ?? "";
    const key = str(formData, "key") ?? "";
    const reset = formData.get("reset") === "1";
    await runAsActor(actor, (tx) =>
      reset
        ? resetText(tx, actor, code, key)
        : saveText(tx, actor, code, {
            key,
            value:
              typeof formData.get("value") === "string"
                ? String(formData.get("value"))
                : "",
          }),
    );
    revalidatePath(`/platform/settings/languages/${code}`);
    revalidatePath("/", "layout");
    return {
      success: true,
      message: (await getTranslations("languages"))(
        reset ? "textReset" : "textSaved",
      ),
    };
  } catch (err) {
    return failure(err);
  }
}

/** The person's own language; empty follows the workspace. */
export async function saveMyLanguageAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  try {
    const identity = await requireUser();
    await withIdentityContext(prisma, identity.userId, (tx) =>
      setUserLocale(tx, identity.userId, str(formData, "locale") ?? null),
    );
    revalidatePath("/", "layout");
    return {
      success: true,
      message: (await getTranslations("preferences"))("saved"),
    };
  } catch (err) {
    return failure(err);
  }
}

/** Default language of a workspace; empty follows the platform. */
export async function saveWorkspaceLanguageAction(
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
    await withContext(prisma, ctx, (tx) =>
      setWorkspaceLocale(tx, ctx, str(formData, "locale") ?? null),
    );
    revalidatePath("/", "layout");
    return {
      success: true,
      message: (await getTranslations("preferences"))("saved"),
    };
  } catch (err) {
    return failure(err);
  }
}
