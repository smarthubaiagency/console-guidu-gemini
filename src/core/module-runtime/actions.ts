"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireMfa, requireUser } from "@/core/auth/identity";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AppError, type AppErrorCode, toSafeError } from "@/shared/errors";

import {
  setPlatformModuleAvailability,
  setWorkspaceModuleStatus,
} from "./settings";

export type ModuleActionState = {
  success?: boolean;
  message?: string;
  error?: string;
  code?: AppErrorCode;
  requestId?: string;
};

function failure(err: unknown): ModuleActionState {
  const safe = toSafeError(err);
  return {
    error: safe.safeMessage,
    code: safe.code,
    requestId: safe.requestId,
  };
}

const moduleKey = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
  .max(48);

const WorkspaceStatusInput = z.object({
  workspaceSlug: z.string().min(1),
  moduleKey,
  status: z.enum(["enabled", "disabled"]),
});

/** Enables or disables a module in the workspace (ADR 0005). */
export async function setWorkspaceModuleStatusAction(
  _prev: ModuleActionState,
  formData: FormData,
): Promise<ModuleActionState> {
  const parsed = WorkspaceStatusInput.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    moduleKey: formData.get("moduleKey"),
    status: formData.get("status"),
  });
  if (!parsed.success) {
    return failure(
      new AppError({ code: "invalid_input", safeMessage: "Dados inválidos." }),
    );
  }
  const { workspaceSlug, status } = parsed.data;

  try {
    const identity = await requireUser();
    const context = await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      workspaceSlug,
    );
    await withContext(prisma, context, (tx) =>
      setWorkspaceModuleStatus(tx, context, parsed.data.moduleKey, status),
    );
    revalidatePath(`/app/${workspaceSlug}`, "layout");
    return {
      success: true,
      message:
        status === "enabled" ? "Módulo habilitado." : "Módulo desabilitado.",
    };
  } catch (err) {
    return failure(err);
  }
}

const PlatformAvailabilityInput = z.object({
  moduleKey,
  availability: z.enum(["enabled", "maintenance", "disabled"]),
});

/** Changes the global availability of a module (ADR 0005, admin side). */
export async function setPlatformModuleAvailabilityAction(
  _prev: ModuleActionState,
  formData: FormData,
): Promise<ModuleActionState> {
  const parsed = PlatformAvailabilityInput.safeParse({
    moduleKey: formData.get("moduleKey"),
    availability: formData.get("availability"),
  });
  if (!parsed.success) {
    return failure(
      new AppError({ code: "invalid_input", safeMessage: "Dados inválidos." }),
    );
  }

  try {
    // Admin console requires AAL2 (AC17), revalidated here, not only in the layout.
    const identity = await requireMfa();
    const admin = await getPlatformAdminMember(prisma, identity.userId);
    await withIdentityContext(prisma, identity.userId, (tx) =>
      setPlatformModuleAvailability(
        tx,
        identity.userId,
        admin?.status === "active" ? admin.role : null,
        parsed.data.moduleKey,
        parsed.data.availability,
      ),
    );
    revalidatePath("/platform", "layout");
    revalidatePath("/app", "layout");
    return { success: true, message: "Disponibilidade atualizada." };
  } catch (err) {
    return failure(err);
  }
}
