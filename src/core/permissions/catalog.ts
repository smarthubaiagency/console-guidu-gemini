/**
 * ============================================================================
 * File: src/core/permissions/catalog.ts
 * Module: Core Permissions Catalog
 *
 * Maintenance Rationale:
 * - Specification Section 7: "Papéis mapeiam permissões, como workspace.members.invite
 *   e integrations.manage. Não espalhar comparações de nome de papel pelo código.
 *   Exportar, excluir, publicar, alterar credenciais e delegar acesso são permissões distintas."
 * - Stable, typed namespaced permission identifiers for the core domain.
 * - Does NOT define permissions for unreleased/unspecified modules (Catalog, Google Business).
 * ============================================================================
 */

export const Permissions = {
  // Workspace core
  WORKSPACE_READ: "workspace.read",
  WORKSPACE_SETTINGS_UPDATE: "workspace.settings.update",
  WORKSPACE_MEMBERS_READ: "workspace.members.read",
  WORKSPACE_MEMBERS_INVITE: "workspace.members.invite",
  WORKSPACE_MEMBERS_MANAGE: "workspace.members.manage",
  /** Enable or disable modules in the workspace (ADR 0005). */
  WORKSPACE_MODULES_MANAGE: "workspace.modules.manage",

  // BYOK Credentials Vault (Spec §16)
  CREDENTIALS_READ: "credentials.read",
  CREDENTIALS_MANAGE: "credentials.manage",

  // Platform API Keys & MCP Token Authentication (ADR 0009, Spec §17.3)
  API_KEYS_CREATE_OWN: "api_keys.create_own",
  API_KEYS_REVOKE_OWN: "api_keys.revoke_own",
  API_KEYS_REVOKE_ANY: "api_keys.revoke_any",
  API_KEYS_READ_ALL: "api_keys.read_all",

  // AI Agents (Spec §7, declared only — module technically frozen by C04)
  AI_AGENTS_USE: "ai_agents.use",
  AI_AGENTS_MANAGE: "ai_agents.manage",

  // Organization core
  ORGANIZATION_READ: "organization.read",
  ORGANIZATION_MEMBERS_INVITE: "organization.members.invite",
  ORGANIZATION_MEMBERS_MANAGE: "organization.members.manage",
  ORGANIZATION_SETTINGS_UPDATE: "organization.settings.update",

  // Platform administration of modules (ADR 0005: /platform/modules and
  // /platform/settings/modules/[moduleKey]); granted by internal role, never by
  // workspace role.
  PLATFORM_MODULES_READ: "platform.modules.read",
  PLATFORM_MODULES_MANAGE: "platform.modules.manage",

  // Brand of the house partner served on the platform hosts (ADR 0012, P3).
  PLATFORM_BRAND_MANAGE: "platform.brand.manage",

  // Partner management in the platform console (ADR 0012, P4).
  PLATFORM_PARTNERS_READ: "platform.partners.read",
  PLATFORM_PARTNERS_MANAGE: "platform.partners.manage",

  // Partner console (/admin), granted only by partner roles (D-PA-02).
  PARTNER_READ: "partner.read",
  PARTNER_CUSTOMERS_READ: "partner.customers.read",
  PARTNER_MEMBERS_MANAGE: "partner.members.manage",
  PARTNER_BRAND_MANAGE: "partner.brand.manage",
  // Register customers, workspace templates and the module catalog (P4b).
  PARTNER_CUSTOMERS_MANAGE: "partner.customers.manage",
} as const;

export type Permission = (typeof Permissions)[keyof typeof Permissions];

/**
 * Permission declared by a registered module manifest (`<namespace>.<action>`).
 * Resolved against the module registry by the server guard; unknown keys deny.
 */
export type ModulePermissionKey = `${string}.${string}`;

/** Any permission the server guard can evaluate. */
export type PermissionKey = Permission | ModulePermissionKey;

/** Set of all declared permissions for catalog verification. */
export const ALL_PERMISSIONS = Object.freeze(
  new Set<Permission>(Object.values(Permissions)),
);
