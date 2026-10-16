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
 * - Module permissions live in each manifest; the partner permission of
 *   Google Business (GB1a) is here because partner roles are core.
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
  /** Export all data of the workspace (F3e, AC12). */
  WORKSPACE_DATA_EXPORT: "workspace.data.export",
  /** Schedule or cancel the deletion of the workspace (F3e). */
  WORKSPACE_DELETE: "workspace.delete",
  /** Review, approve and reject MCP proposals (F4d, §17.4). */
  WORKSPACE_PROPOSALS_REVIEW: "workspace.proposals.review",
  /** Stores and properties of the business (UCP Location, F5a). */
  WORKSPACE_LOCATIONS_MANAGE: "workspace.locations.manage",
  /**
   * Approve or deny a request for the managed mode and go back to
   * `padrao` (GB1c, ADR 0020): the company owner only.
   */
  WORKSPACE_SERVICE_MODE_MANAGE: "workspace.service_mode.manage",

  // BYOK Credentials Vault (Spec §16)
  CREDENTIALS_READ: "credentials.read",
  CREDENTIALS_MANAGE: "credentials.manage",

  // Messaging channels of the workspace (ADR 0011, A5a)
  CHANNELS_READ: "channels.read",
  CHANNELS_MANAGE: "channels.manage",

  // Platform API Keys & MCP Token Authentication (ADR 0009, Spec §17.3)
  API_KEYS_CREATE_OWN: "api_keys.create_own",
  API_KEYS_REVOKE_OWN: "api_keys.revoke_own",
  API_KEYS_REVOKE_ANY: "api_keys.revoke_any",
  API_KEYS_READ_ALL: "api_keys.read_all",

  // AI Agents: GUIDS of the workspace (especificação de agentes §11)
  AI_AGENTS_USE: "ai_agents.use",
  AI_AGENTS_MANAGE: "ai_agents.manage",
  // Conversations, transcripts and audio of the GUIDS (A2a).
  AI_AGENTS_CONVERSATIONS_READ: "ai_agents.conversations.read",

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
  // Terms and privacy of the house partner (P4b2).
  PLATFORM_LEGAL_MANAGE: "platform.legal.manage",

  // Partner management in the platform console (ADR 0012, P4).
  PLATFORM_PARTNERS_READ: "platform.partners.read",
  PLATFORM_PARTNERS_MANAGE: "platform.partners.manage",
  // Plans, floors, split rules and amounts due per partner (P5m).
  PLATFORM_BILLING_READ: "platform.billing.read",
  PLATFORM_BILLING_MANAGE: "platform.billing.manage",
  // Customer companies with minimal commercial data (/platform/customers,
  // API and MCP of the platform, F4e).
  PLATFORM_CUSTOMERS_READ: "platform.customers.read",
  // Health, queues, failures and job volume (/platform/operations, F3d).
  PLATFORM_OPERATIONS_READ: "platform.operations.read",
  // Languages and texts of the dashboard (I1, Plataforma › Configurações ›
  // Idiomas).
  PLATFORM_LANGUAGES_MANAGE: "platform.languages.manage",
  // House agent templates, the admin template of the partner Assistants,
  // the GUIDU knowledge base and the backup key and model (A1, §11).
  PLATFORM_AI_MANAGE: "platform.ai.manage",
  // Platform defaults of the settings catalog (CF1, Plataforma ›
  // Configurações › Geral).
  PLATFORM_SETTINGS_MANAGE: "platform.settings.manage",
  // Configurações › Segurança and its events (CF5a); editing needs
  // platform.settings.manage.
  PLATFORM_SECURITY_READ: "platform.security.read",
  // Central de Eventos (H1, ADR 0022): the situation of every event and of
  // its deliveries, never the data (billing: only billing events).
  PLATFORM_EVENTS_READ: "platform.events.read",
  // The full data of any event: only the `keychain` capability gives it,
  // never a role; each opening asks for MFA and a reason and is audited.
  PLATFORM_EVENTS_READ_ALL_DATA: "platform.events.read_all_data",
  // Grant and remove capabilities (`keychain`) of the platform team.
  PLATFORM_CAPABILITIES_MANAGE: "platform.capabilities.manage",
  // Plataforma › Auditoria (AUD1): the whole audit trail; the database
  // narrows billing to the billing actions.
  PLATFORM_AUDIT_READ: "platform.audit.read",
  // Ask a direct customer (partner zero) for the managed mode (GB1c).
  PLATFORM_SERVICE_MODE_REQUEST: "platform.service_mode.request",

  // Partner console (/admin), granted only by partner roles (D-PA-02).
  PARTNER_READ: "partner.read",
  PARTNER_CUSTOMERS_READ: "partner.customers.read",
  PARTNER_MEMBERS_MANAGE: "partner.members.manage",
  PARTNER_BRAND_MANAGE: "partner.brand.manage",
  // Register customers, workspace templates and the module catalog (P4b).
  PARTNER_CUSTOMERS_MANAGE: "partner.customers.manage",
  // Terms and privacy of the partner, and temporary support access (P4b2).
  PARTNER_LEGAL_MANAGE: "partner.legal.manage",
  PARTNER_SUPPORT_REQUEST: "partner.support.request",
  // Partner prices, billing profile, customer subscriptions, manual payments
  // and the "Ativar checkout" switch (P5m).
  PARTNER_BILLING_READ: "partner.billing.read",
  PARTNER_BILLING_MANAGE: "partner.billing.manage",
  // The partner's Assistant, its agent templates and the configuration of
  // its customers' GUIDS, never their conversations (A1, D-AG-17).
  PARTNER_AI_AGENTS_READ: "partner.ai_agents.read",
  PARTNER_AI_AGENTS_MANAGE: "partner.ai_agents.manage",
  // The partner's defaults of the settings catalog for its customers (CF1,
  // /admin › Configurações).
  PARTNER_SETTINGS_MANAGE: "partner.settings.manage",
  // Configurações › Segurança and the partner's security events (CF5a).
  PARTNER_SECURITY_READ: "partner.security.read",
  // Operate the Google fichas of the companies the partner manages (GB1a,
  // ADR 0020): onboarding, automation page and the GMN agent.
  PARTNER_GOOGLE_BUSINESS_MANAGE: "partner.google_business.manage",
  // Ask a customer for the managed mode and cancel the request (GB1c).
  PARTNER_SERVICE_MODE_REQUEST: "partner.service_mode.request",
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
