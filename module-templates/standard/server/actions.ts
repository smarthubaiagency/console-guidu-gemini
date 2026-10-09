"use server";

import { revalidatePath } from "next/cache";

import { resolveWorkspaceContext } from "@/core/auth/context";
import { requireUser } from "@/core/auth/identity";
import { saveWorkspaceModuleConfig } from "@/core/module-runtime/settings";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { toSafeError } from "@/shared/errors";

export type __ModuleName__ActionState = { success?: boolean; message?: string; error?: string };

/** Server actions revalidate identity, context and permission themselves. */
export async function save__ModuleName__SettingsAction(
  _prev: __ModuleName__ActionState,
  formData: FormData,
): Promise<__ModuleName__ActionState> {
  try {
    const workspaceSlug = String(formData.get("workspaceSlug") ?? "");
    const identity = await requireUser();
    const context = await resolveWorkspaceContext(prisma, identity.userId, workspaceSlug);
    await withContext(prisma, context, (tx) =>
      saveWorkspaceModuleConfig(tx, context, "__MODULE_KEY__", {}),
    );
    revalidatePath(`/app/${workspaceSlug}`, "layout");
    return { success: true, message: "Configuração salva." };
  } catch (err) {
    return { error: toSafeError(err).safeMessage };
  }
}
