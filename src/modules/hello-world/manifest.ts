import { z } from "zod";

import { defineModuleManifest } from "@/core/module-contracts/manifest";

/**
 * Módulo de referência (Adendo §9). Valida o contrato de módulos: menu com
 * submenu, Settings de cliente e admin, permissões próprias, limite de
 * demonstração e auditoria. Não é um produto comercial e só fica disponível
 * com GUIDU_MODULE_HELLO_WORLD_ENABLED="true" (desenvolvimento e testes).
 */

/** Limite de demonstração de registros por workspace; não é cota comercial. */
export const HELLO_WORLD_DEMO_RECORD_LIMIT = 10;

export const HELLO_WORLD_FALLBACK_GREETING = "Hello, World!";

export const helloWorldWorkspaceConfigSchema = z
  .object({
    greeting: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

export const helloWorldAdminConfigSchema = z
  .object({
    defaultGreeting: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

export type HelloWorldWorkspaceConfig = z.infer<
  typeof helloWorldWorkspaceConfigSchema
>;
export type HelloWorldAdminConfig = z.infer<typeof helloWorldAdminConfigSchema>;

export const HelloWorldPermissions = {
  READ: "hello_world.read",
  RECORDS_WRITE: "hello_world.records.write",
  SETTINGS_MANAGE: "hello_world.settings.manage",
} as const;

export const helloWorldManifest = defineModuleManifest({
  moduleKey: "hello-world",
  displayName: "Hello World",
  description:
    "Módulo de referência que valida o contrato de módulos da plataforma.",
  moduleVersion: "1.0.0",
  contractVersion: "1.0.0",
  platformCompatibility: { minPlatformVersion: "0.1.0" },
  templateVersion: "1.0.0",
  releaseStatus: "beta",
  routes: [
    { routeKey: "hello-world.home", destination: "app", path: "hello-world" },
    {
      routeKey: "hello-world.records",
      destination: "app",
      path: "hello-world/records",
    },
    {
      routeKey: "hello-world.record",
      destination: "app",
      path: "hello-world/records/[recordId]",
    },
  ],
  navigation: [
    {
      id: "hello-world",
      destination: "app",
      groupKey: "modules",
      label: "Hello World",
      iconKey: "hand",
      order: 90,
      requiredPermissions: [HelloWorldPermissions.READ],
      children: [
        {
          id: "hello-world.home",
          label: "Saudação",
          routeKey: "hello-world.home",
          iconKey: "sparkles",
          order: 0,
          requiredPermissions: [HelloWorldPermissions.READ],
        },
        {
          id: "hello-world.records",
          label: "Registros",
          routeKey: "hello-world.records",
          iconKey: "list",
          order: 10,
          requiredPermissions: [HelloWorldPermissions.READ],
        },
      ],
    },
  ],
  settings: [
    {
      id: "hello-world.workspace",
      destination: "workspace",
      label: "Hello World",
      order: 90,
      componentKey: "hello-world.workspace-settings",
      readPermissions: [HelloWorldPermissions.READ],
      writePermissions: [HelloWorldPermissions.SETTINGS_MANAGE],
    },
    {
      id: "hello-world.admin",
      destination: "admin",
      label: "Hello World",
      order: 90,
      componentKey: "hello-world.admin-settings",
      readPermissions: ["platform.modules.read"],
      writePermissions: ["platform.modules.manage"],
    },
  ],
  permissions: [
    {
      key: HelloWorldPermissions.READ,
      description: "Ver a saudação e os registros de exemplo.",
      defaultWorkspaceRoles: ["owner", "admin", "editor", "viewer"],
    },
    {
      key: HelloWorldPermissions.RECORDS_WRITE,
      description: "Criar registros de exemplo.",
      defaultWorkspaceRoles: ["owner", "admin", "editor"],
    },
    {
      key: HelloWorldPermissions.SETTINGS_MANAGE,
      description: "Alterar a saudação do workspace.",
      defaultWorkspaceRoles: ["owner", "admin"],
    },
  ],
  entitlements: [
    {
      key: "hello-world.records",
      kind: "quota",
      description: "Limite de demonstração de registros por workspace.",
      defaultLimit: HELLO_WORLD_DEMO_RECORD_LIMIT,
    },
  ],
  configurationSchema: {
    workspace: helloWorldWorkspaceConfigSchema,
    admin: helloWorldAdminConfigSchema,
  },
  capabilities: ["settings", "jobs"],
});
