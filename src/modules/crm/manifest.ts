import { defineModuleManifest } from "@/core/module-contracts/manifest";

/**
 * Módulo CRM (F4c, plano F4 decisão 3). Começa só com contatos; leads,
 * empresas, negócios e tarefas entram depois como novos objetos deste
 * módulo, cada um com a sua especificação (MODULE_SPEC.md).
 */

/** Contatos por workspace quando o plano não define limite (provisório). */
export const CRM_DEFAULT_CONTACT_LIMIT = 5000;

export const CrmPermissions = {
  CONTACTS_READ: "crm.contacts.read",
  CONTACTS_WRITE: "crm.contacts.write",
} as const;

export const crmManifest = defineModuleManifest({
  moduleKey: "crm",
  displayName: "CRM",
  description:
    "Contatos do workspace; leads, empresas, negócios e tarefas virão depois.",
  moduleVersion: "0.1.0",
  contractVersion: "1.0.0",
  platformCompatibility: { minPlatformVersion: "0.1.0" },
  templateVersion: "1.0.0",
  releaseStatus: "beta",
  routes: [
    { routeKey: "crm.contacts", destination: "app", path: "crm/contacts" },
    {
      routeKey: "crm.contact",
      destination: "app",
      path: "crm/contacts/[contactId]",
    },
  ],
  navigation: [
    {
      id: "crm",
      destination: "app",
      groupKey: "modules",
      label: "CRM",
      iconKey: "users",
      order: 20,
      requiredPermissions: [CrmPermissions.CONTACTS_READ],
      children: [
        {
          id: "crm.contacts",
          label: "Contatos",
          routeKey: "crm.contacts",
          iconKey: "list",
          order: 0,
          requiredPermissions: [CrmPermissions.CONTACTS_READ],
        },
      ],
    },
  ],
  permissions: [
    {
      key: CrmPermissions.CONTACTS_READ,
      description: "Ver os contatos do workspace.",
      defaultWorkspaceRoles: ["owner", "admin", "editor", "viewer"],
    },
    {
      key: CrmPermissions.CONTACTS_WRITE,
      description: "Criar e editar contatos.",
      defaultWorkspaceRoles: ["owner", "admin", "editor"],
    },
  ],
  entitlements: [
    {
      key: "crm.contacts",
      kind: "quota",
      description: "Contatos por workspace.",
      defaultLimit: CRM_DEFAULT_CONTACT_LIMIT,
    },
  ],
  capabilities: ["export", "api", "mcp"],
});
