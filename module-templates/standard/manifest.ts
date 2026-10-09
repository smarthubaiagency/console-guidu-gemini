import { z } from "zod";

import { defineModuleManifest } from "@/core/module-contracts/manifest";

export const __ModuleName__Permissions = {
  READ: "__MODULE_NS__.read",
  SETTINGS_MANAGE: "__MODULE_NS__.settings.manage",
} as const;

/** Validates what the workspace Settings component saves (ADR 0006). */
export const __ModuleName__WorkspaceConfigSchema = z.object({}).strict();

export const __ModuleName__Manifest = defineModuleManifest({
  moduleKey: "__MODULE_KEY__",
  displayName: "__MODULE_NAME__",
  description: "Descrição curta aprovada na MODULE_SPEC.md.",
  moduleVersion: "0.1.0",
  contractVersion: "1.0.0",
  platformCompatibility: { minPlatformVersion: "0.1.0" },
  templateVersion: "1.0.0",
  releaseStatus: "beta",
  routes: [{ routeKey: "__MODULE_KEY__.home", destination: "app", path: "__MODULE_KEY__" }],
  navigation: [
    {
      id: "__MODULE_KEY__",
      destination: "app",
      groupKey: "modules",
      label: "__MODULE_NAME__",
      routeKey: "__MODULE_KEY__.home",
      iconKey: "puzzle",
      order: 100,
      requiredPermissions: [__ModuleName__Permissions.READ],
    },
  ],
  settings: [
    {
      id: "__MODULE_KEY__.workspace",
      destination: "workspace",
      label: "__MODULE_NAME__",
      order: 100,
      componentKey: "__MODULE_KEY__.workspace-settings",
      readPermissions: [__ModuleName__Permissions.READ],
      writePermissions: [__ModuleName__Permissions.SETTINGS_MANAGE],
    },
  ],
  permissions: [
    {
      key: __ModuleName__Permissions.READ,
      description: "Ver o módulo.",
      defaultWorkspaceRoles: [],
    },
    {
      key: __ModuleName__Permissions.SETTINGS_MANAGE,
      description: "Alterar a configuração do módulo no workspace.",
      defaultWorkspaceRoles: [],
    },
  ],
  entitlements: [],
  configurationSchema: { workspace: __ModuleName__WorkspaceConfigSchema },
  capabilities: ["settings"],
});
