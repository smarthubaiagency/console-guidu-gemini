import "server-only";

import { assertModuleOperational } from "@/core/module-runtime/state";
import {
  getPlatformModuleConfig,
  getWorkspaceModuleConfig,
} from "@/core/module-runtime/settings";
import { requireWorkspacePermission } from "@/core/permissions/guard";
import type {
  ContextTransaction,
  RequestContext,
} from "@/lib/prisma/with-context";

import {
  HELLO_WORLD_FALLBACK_GREETING,
  HelloWorldPermissions,
  helloWorldAdminConfigSchema,
  helloWorldWorkspaceConfigSchema,
} from "../../manifest";

const MODULE_KEY = "hello-world";

export type GreetingOrigin = "workspace" | "global" | "fallback";

export type ResolvedGreeting = Readonly<{
  greeting: string;
  origin: GreetingOrigin;
}>;

/**
 * Effective greeting with explicit origin (Adendo §8.2): the workspace
 * override wins, then the global default, then the module fallback.
 */
export function pickGreeting(
  workspaceConfig: Record<string, unknown>,
  globalConfig: Record<string, unknown>,
): ResolvedGreeting {
  const workspace = helloWorldWorkspaceConfigSchema.safeParse(workspaceConfig);
  if (workspace.success && workspace.data.greeting) {
    return { greeting: workspace.data.greeting, origin: "workspace" };
  }
  const global = helloWorldAdminConfigSchema.safeParse(globalConfig);
  if (global.success && global.data.defaultGreeting) {
    return { greeting: global.data.defaultGreeting, origin: "global" };
  }
  return { greeting: HELLO_WORLD_FALLBACK_GREETING, origin: "fallback" };
}

export async function resolveHelloWorldGreeting(
  tx: ContextTransaction,
  ctx: RequestContext,
): Promise<ResolvedGreeting> {
  await assertModuleOperational(tx, ctx, MODULE_KEY);
  await requireWorkspacePermission(tx, ctx, HelloWorldPermissions.READ);
  const [workspaceConfig, globalConfig] = await Promise.all([
    getWorkspaceModuleConfig(tx, ctx, MODULE_KEY),
    getPlatformModuleConfig(tx, MODULE_KEY),
  ]);
  return pickGreeting(workspaceConfig, globalConfig);
}
