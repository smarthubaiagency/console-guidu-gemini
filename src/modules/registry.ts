/**
 * ============================================================================
 * File: src/modules/registry.ts
 * Module: Central Module Registry (ADR 0006, Adendo §4 e §8)
 *
 * Maintenance Rationale:
 * - Lists every module included in this build by explicit import. Nothing is
 *   discovered at runtime and nothing comes from the database.
 * - Validated once, at import time: a broken manifest fails tests and build.
 * - `technicalGate` is the environment switch for modules that must stay off
 *   by default: Agentes de IA (frozen by C04) and the reference module, which
 *   is restricted to development and tests (Adendo §3 e §9).
 * - Server-side only. Browsers receive navigation DTOs, never manifests.
 * ============================================================================
 */

import "server-only";

import { ALL_PERMISSIONS } from "@/core/permissions/catalog";
import type { ModuleManifest } from "@/core/module-contracts/manifest";
import { validateModuleRegistry } from "@/core/module-contracts/validate";

import { aiAgentsManifest } from "./ai-agents/manifest";
import { catalogManifest } from "./catalog/manifest";
import { googleBusinessManifest } from "./google-business/manifest";
import { helloWorldManifest } from "./hello-world/manifest";

type RegistryEntryInput = Readonly<{
  manifest: Parameters<typeof validateModuleRegistry>[0][number];
  /** Returns false when the module is switched off in this environment. */
  technicalGate?: () => boolean;
}>;

const ENTRIES: readonly RegistryEntryInput[] = [
  { manifest: catalogManifest },
  { manifest: googleBusinessManifest },
  {
    manifest: aiAgentsManifest,
    technicalGate: () => process.env.GUIDU_MODULE_AI_AGENTS_ENABLED === "true",
  },
  {
    manifest: helloWorldManifest,
    technicalGate: () =>
      process.env.GUIDU_MODULE_HELLO_WORLD_ENABLED === "true",
  },
];

export type RegisteredModule = Readonly<{
  manifest: ModuleManifest;
  technicalGate: () => boolean;
}>;

const validated = validateModuleRegistry(
  ENTRIES.map((entry) => entry.manifest),
  { corePermissions: ALL_PERMISSIONS },
);

const MODULES: ReadonlyMap<string, RegisteredModule> = new Map(
  validated.map((manifest, index) => [
    manifest.moduleKey,
    Object.freeze({
      manifest,
      technicalGate: ENTRIES[index]?.technicalGate ?? (() => true),
    }),
  ]),
);

export type ModuleKey =
  "catalog" | "google-business" | "ai-agents" | "hello-world";

/** All registered modules, in registration order. */
export function listRegisteredModules(): readonly RegisteredModule[] {
  return [...MODULES.values()];
}

export function getRegisteredModule(
  moduleKey: string,
): RegisteredModule | null {
  return MODULES.get(moduleKey) ?? null;
}

export function isRegisteredModuleKey(value: string): value is ModuleKey {
  return MODULES.has(value);
}

/**
 * Workspace roles granted a module permission by default, or null when no
 * registered module declares it (callers must deny).
 */
export function getModulePermissionRoles(
  permission: string,
): readonly string[] | null {
  for (const { manifest } of MODULES.values()) {
    const declared = manifest.permissions.find((p) => p.key === permission);
    if (declared) return declared.defaultWorkspaceRoles;
  }
  return null;
}
