/**
 * ============================================================================
 * File: src/core/module-contracts/manifest.ts
 * Module: Module Manifest Contract (ADR 0006, Adendo §5 e §8)
 *
 * Maintenance Rationale:
 * - The manifest is the safe metadata a module hands to the platform. It holds
 *   no secrets, no React components and no server code: `routeKey` and
 *   `componentKey` are references resolved by explicit registries in code.
 * - `configurationSchema` validates what the components declared in
 *   `settings` save (ADR 0006: one configuration mechanism).
 * - The manifest does not create tables, routes or permissions by itself; the
 *   matching wrappers, migrations and registrations must exist.
 * ============================================================================
 */

import { z } from "zod";

/** Version of the common module interface implemented by this platform. */
export const MODULE_CONTRACT_VERSION = "1.0.0";

/** Platform version used for `platformCompatibility` checks. */
export const PLATFORM_VERSION = "0.1.0";

const SEMVER = /^\d+\.\d+\.\d+$/;
const MODULE_KEY = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const STABLE_ID = /^[a-z][a-z0-9]*(?:[-.][a-z0-9]+)*$/;
const PERMISSION_KEY = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const ROUTE_SEGMENT = /^(?:[a-z0-9]+(?:-[a-z0-9]+)*|\[[a-zA-Z][a-zA-Z0-9]*\])$/;

/** Icons a module may reference. The client maps each key to a component. */
export const MODULE_ICON_KEYS = [
  "bot",
  "file-text",
  "hand",
  "layout-dashboard",
  "list",
  "puzzle",
  "settings",
  "shopping-bag",
  "sparkles",
  "store",
] as const;

export const MODULE_RELEASE_STATUSES = [
  "coming_soon",
  "beta",
  "available",
  "maintenance",
] as const;

export const MODULE_CAPABILITIES = [
  "summary",
  "settings",
  "jobs",
  "export",
  "mcp",
  "api",
] as const;

export const WORKSPACE_ROLE_KEYS = [
  "owner",
  "admin",
  "editor",
  "viewer",
] as const;

const semver = z.string().regex(SEMVER, "Use versão semântica X.Y.Z.");
const stableId = z.string().regex(STABLE_ID).max(80);
const permissionKey = z.string().regex(PERMISSION_KEY).max(80);
const label = z.string().trim().min(1).max(48);

export const ModuleRouteSchema = z.object({
  routeKey: stableId,
  /**
   * "admin" is the platform console, served at `/platform` since ADR 0012.
   * The value stays "admin" to keep contract 1.0.0 stable; any rename comes
   * with the partner console (P4) and a contract version bump.
   */
  destination: z.enum(["app", "admin"]),
  /**
   * Path relative to `/app/[workspaceSlug]` or `/platform`, without leading
   * slash. Static wrappers must exist in `src/app`; the manifest does not
   * create them.
   */
  path: z
    .string()
    .min(1)
    .max(120)
    .refine(
      (value) =>
        value.split("/").every((segment) => ROUTE_SEGMENT.test(segment)),
      "Segmentos em minúsculas com hífen, ou [parametro].",
    ),
});

const NavigationChildSchema = z.object({
  id: stableId,
  label,
  routeKey: stableId,
  iconKey: z.enum(MODULE_ICON_KEYS).optional(),
  order: z.number().int().min(0).max(1000),
  requiredPermissions: z.array(permissionKey).default([]),
});

export const ModuleNavigationEntrySchema = NavigationChildSchema.extend({
  destination: z.enum(["app", "admin"]),
  groupKey: z.enum(["modules"]),
  /** Absent when the entry only groups its children. */
  routeKey: stableId.optional(),
  /** One level of children keeps navigation simple (Adendo §8.1). */
  children: z.array(NavigationChildSchema).max(8).default([]),
});

export const ModuleSettingsEntrySchema = z.object({
  id: stableId,
  destination: z.enum(["workspace", "admin"]),
  label,
  order: z.number().int().min(0).max(1000),
  componentKey: stableId,
  readPermissions: z.array(permissionKey).default([]),
  writePermissions: z.array(permissionKey).default([]),
});

export const ModulePermissionSchema = z.object({
  key: permissionKey,
  description: z.string().trim().min(1).max(160),
  /** Workspace roles granted by default. Empty means no role gets it. */
  defaultWorkspaceRoles: z.array(z.enum(WORKSPACE_ROLE_KEYS)).default([]),
});

export const ModuleEntitlementSchema = z.object({
  key: stableId,
  kind: z.enum(["capability", "quota"]),
  description: z.string().trim().min(1).max(160),
});

const zodSchema = z.custom<z.ZodType>(
  (value) => value instanceof z.ZodType,
  "Esperado um schema Zod.",
);

export const ModuleManifestSchema = z.object({
  moduleKey: z.string().regex(MODULE_KEY).max(48),
  displayName: label,
  description: z.string().trim().min(1).max(200),
  moduleVersion: semver,
  contractVersion: semver,
  platformCompatibility: z.object({ minPlatformVersion: semver }),
  /** Version of module-templates/standard the module was created from. */
  templateVersion: semver.optional(),
  releaseStatus: z.enum(MODULE_RELEASE_STATUSES),
  routes: z.array(ModuleRouteSchema).default([]),
  navigation: z.array(ModuleNavigationEntrySchema).default([]),
  settings: z.array(ModuleSettingsEntrySchema).default([]),
  permissions: z.array(ModulePermissionSchema).default([]),
  entitlements: z.array(ModuleEntitlementSchema).default([]),
  dependencies: z
    .object({
      required: z.array(z.string().regex(MODULE_KEY)).default([]),
      optional: z.array(z.string().regex(MODULE_KEY)).default([]),
    })
    .default({ required: [], optional: [] }),
  configurationSchema: z
    .object({
      workspace: zodSchema.optional(),
      admin: zodSchema.optional(),
    })
    .default({}),
  capabilities: z.array(z.enum(MODULE_CAPABILITIES)).default([]),
});

export type ModuleManifestInput = z.input<typeof ModuleManifestSchema>;
export type ModuleManifest = z.output<typeof ModuleManifestSchema>;
export type ModuleRoute = z.output<typeof ModuleRouteSchema>;
export type ModuleNavigationEntry = z.output<
  typeof ModuleNavigationEntrySchema
>;
export type ModuleSettingsEntry = z.output<typeof ModuleSettingsEntrySchema>;
export type ModulePermission = z.output<typeof ModulePermissionSchema>;
export type ModuleIconKey = (typeof MODULE_ICON_KEYS)[number];
export type ModuleReleaseStatus = (typeof MODULE_RELEASE_STATUSES)[number];

/**
 * Typed helper for module authors. Validation happens in the registry, so a
 * broken manifest fails the registry tests and the build, not a request.
 */
export function defineModuleManifest(
  manifest: ModuleManifestInput,
): ModuleManifestInput {
  return manifest;
}
