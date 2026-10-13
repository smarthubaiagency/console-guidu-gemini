import "server-only";

import { notFound, redirect } from "next/navigation";

import { getPlatformAdminMember } from "@/core/admin/platform";
import { isModuleTechnicallyAvailable } from "@/core/modules/availability";
import { Permissions } from "@/core/permissions/catalog";
import {
  hasPlatformRolePermission,
  type PlatformAdminRoleKey,
} from "@/core/permissions/matrix";
import { prisma } from "@/lib/prisma/client";

/** 404 while the AI agents module is off in this environment (C04). */
export function requireAiModule(): void {
  if (!isModuleTechnicallyAvailable("ai-agents")) notFound();
}

/**
 * The role of a platform member who may manage the house's AI
 * (`platform.ai.manage`); anyone else goes to the denial page. Called after
 * requirePlatformAdminPage.
 */
export async function requirePlatformAiRole(
  userId: string,
): Promise<PlatformAdminRoleKey> {
  const member = await getPlatformAdminMember(prisma, userId);
  const role =
    member?.status === "active" ? (member.role as PlatformAdminRoleKey) : null;
  if (
    !role ||
    !hasPlatformRolePermission(role, Permissions.PLATFORM_AI_MANAGE)
  ) {
    redirect("/auth/denied");
  }
  return role;
}
