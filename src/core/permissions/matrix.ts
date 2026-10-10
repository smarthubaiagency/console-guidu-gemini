/**
 * ============================================================================
 * File: src/core/permissions/matrix.ts
 * Module: Role -> Permission Matrix
 *
 * Maintenance Rationale:
 * - Specification Section 7: "Papéis mapeiam permissões... Não espalhar
 *   comparações de nome de papel pelo código."
 * - ATENÇÃO: Esta matriz é uma PROPOSTA SUJEITA À CONFIRMAÇÃO DO PRODUTO.
 *   Qualquer alteração futura deve ser registrada e testada nesta fonte única.
 *
 * Herança empresarial (Pendência aberta em docs/pendencias.md):
 * - Por padrão (§7), vínculo na empresa NÃO concede leitura de todos os dados
 *   dos workspaces. Não concedemos a organization owner/admin permissões de
 *   dados do workspace pela matriz.
 * - Mantém-se apenas a concessão de acesso aos workspaces atribuída ao
 *   Organization Owner pela §7 (gerir vínculos e convites de workspace).
 * ============================================================================
 */

import { Permission, Permissions } from "./catalog";
import {
  OrganizationRole,
  OrganizationRoles,
  WorkspaceRole,
  WorkspaceRoles,
} from "./roles";

/** All workspace-scoped permissions. */
const ALL_WORKSPACE_PERMISSIONS: ReadonlySet<Permission> = new Set([
  Permissions.WORKSPACE_READ,
  Permissions.WORKSPACE_SETTINGS_UPDATE,
  Permissions.WORKSPACE_MEMBERS_READ,
  Permissions.WORKSPACE_MEMBERS_INVITE,
  Permissions.WORKSPACE_MEMBERS_MANAGE,
  Permissions.WORKSPACE_MODULES_MANAGE,
  Permissions.CREDENTIALS_READ,
  Permissions.CREDENTIALS_MANAGE,
  Permissions.API_KEYS_CREATE_OWN,
  Permissions.API_KEYS_REVOKE_OWN,
  Permissions.API_KEYS_REVOKE_ANY,
  Permissions.API_KEYS_READ_ALL,
  Permissions.AI_AGENTS_USE,
  Permissions.AI_AGENTS_MANAGE,
]);

/**
 * Workspace role permission mapping (Proposta C06).
 */
export const WORKSPACE_ROLE_PERMISSIONS: Record<
  WorkspaceRole,
  ReadonlySet<Permission>
> = {
  // Workspace Owner: tudo do workspace.
  [WorkspaceRoles.OWNER]: ALL_WORKSPACE_PERMISSIONS,

  // Workspace Admin: tudo do workspace (regras de escalonamento contra owners em roles.ts).
  [WorkspaceRoles.ADMIN]: ALL_WORKSPACE_PERMISSIONS,

  // Workspace Editor: leitura, credenciais mascaradas, chaves próprias e uso de agentes.
  [WorkspaceRoles.EDITOR]: new Set([
    Permissions.WORKSPACE_READ,
    Permissions.WORKSPACE_MEMBERS_READ,
    Permissions.CREDENTIALS_READ,
    Permissions.API_KEYS_CREATE_OWN,
    Permissions.API_KEYS_REVOKE_OWN,
    Permissions.AI_AGENTS_USE,
  ]),

  // Workspace Viewer: leitura básica e chaves próprias (restrição a escopos read-only na C12).
  [WorkspaceRoles.VIEWER]: new Set([
    Permissions.WORKSPACE_READ,
    Permissions.WORKSPACE_MEMBERS_READ,
    Permissions.API_KEYS_CREATE_OWN,
    Permissions.API_KEYS_REVOKE_OWN,
  ]),
};

/** All organization-scoped permissions. */
const ALL_ORGANIZATION_PERMISSIONS: ReadonlySet<Permission> = new Set([
  Permissions.ORGANIZATION_READ,
  Permissions.ORGANIZATION_MEMBERS_INVITE,
  Permissions.ORGANIZATION_MEMBERS_MANAGE,
  Permissions.ORGANIZATION_SETTINGS_UPDATE,
]);

/**
 * Organization role permission mapping (Proposta C06).
 */
export const ORGANIZATION_ROLE_PERMISSIONS: Record<
  OrganizationRole,
  ReadonlySet<Permission>
> = {
  // Organization Owner: administração completa da empresa.
  [OrganizationRoles.OWNER]: ALL_ORGANIZATION_PERMISSIONS,

  // Organization Admin: administração delegada (escalonamento contra owners em roles.ts).
  [OrganizationRoles.ADMIN]: ALL_ORGANIZATION_PERMISSIONS,

  // Organization Member: leitura básica da organização.
  [OrganizationRoles.MEMBER]: new Set([Permissions.ORGANIZATION_READ]),
};

/**
 * Checks whether a given WorkspaceRole has the specified permission.
 */
export function hasWorkspaceRolePermission(
  role: WorkspaceRole,
  permission: Permission,
): boolean {
  return WORKSPACE_ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

/**
 * Checks whether a given OrganizationRole has the specified permission.
 */
export function hasOrganizationRolePermission(
  role: OrganizationRole,
  permission: Permission,
): boolean {
  return ORGANIZATION_ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

/** Internal platform roles (Especificação §7). */
export type PlatformAdminRoleKey =
  "owner" | "operations" | "billing" | "support";

/**
 * Platform admin role permission mapping (Proposta F2, sujeita à confirmação
 * do produto). Billing and support only read module state.
 */
export const PLATFORM_ROLE_PERMISSIONS: Record<
  PlatformAdminRoleKey,
  ReadonlySet<Permission>
> = {
  owner: new Set([
    Permissions.PLATFORM_MODULES_READ,
    Permissions.PLATFORM_MODULES_MANAGE,
    Permissions.PLATFORM_BRAND_MANAGE,
    Permissions.PLATFORM_LEGAL_MANAGE,
    Permissions.PLATFORM_PARTNERS_READ,
    Permissions.PLATFORM_PARTNERS_MANAGE,
  ]),
  operations: new Set([
    Permissions.PLATFORM_MODULES_READ,
    Permissions.PLATFORM_MODULES_MANAGE,
    Permissions.PLATFORM_BRAND_MANAGE,
    Permissions.PLATFORM_LEGAL_MANAGE,
    Permissions.PLATFORM_PARTNERS_READ,
    Permissions.PLATFORM_PARTNERS_MANAGE,
  ]),
  billing: new Set([
    Permissions.PLATFORM_MODULES_READ,
    Permissions.PLATFORM_PARTNERS_READ,
  ]),
  support: new Set([
    Permissions.PLATFORM_MODULES_READ,
    Permissions.PLATFORM_PARTNERS_READ,
  ]),
};

export function hasPlatformRolePermission(
  role: PlatformAdminRoleKey,
  permission: Permission,
): boolean {
  return PLATFORM_ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

/** Partner roles approved by Marcelo (D-PA-02, ADR 0012). */
export type PartnerRoleKey =
  "partner_owner" | "partner_admin" | "partner_finance" | "partner_support";

export const PARTNER_ROLES: readonly PartnerRoleKey[] = [
  "partner_owner",
  "partner_admin",
  "partner_finance",
  "partner_support",
];

/**
 * Partner console permissions (especificação de parceiros §1.2). No partner
 * role reads workspace data; support access comes with a temporary grant
 * (P4b). Plans, prices and payouts arrive with billing (P5).
 */
export const PARTNER_ROLE_PERMISSIONS: Record<
  PartnerRoleKey,
  ReadonlySet<Permission>
> = {
  partner_owner: new Set([
    Permissions.PARTNER_READ,
    Permissions.PARTNER_CUSTOMERS_READ,
    Permissions.PARTNER_CUSTOMERS_MANAGE,
    Permissions.PARTNER_MEMBERS_MANAGE,
    Permissions.PARTNER_BRAND_MANAGE,
    Permissions.PARTNER_LEGAL_MANAGE,
    Permissions.PARTNER_SUPPORT_REQUEST,
  ]),
  partner_admin: new Set([
    Permissions.PARTNER_READ,
    Permissions.PARTNER_CUSTOMERS_READ,
    Permissions.PARTNER_CUSTOMERS_MANAGE,
    Permissions.PARTNER_BRAND_MANAGE,
    Permissions.PARTNER_LEGAL_MANAGE,
    Permissions.PARTNER_SUPPORT_REQUEST,
  ]),
  partner_finance: new Set([
    Permissions.PARTNER_READ,
    Permissions.PARTNER_CUSTOMERS_READ,
  ]),
  partner_support: new Set([
    Permissions.PARTNER_READ,
    Permissions.PARTNER_CUSTOMERS_READ,
    Permissions.PARTNER_SUPPORT_REQUEST,
  ]),
};

export function isPartnerRole(value: string): value is PartnerRoleKey {
  return (PARTNER_ROLES as readonly string[]).includes(value);
}

export function hasPartnerRolePermission(
  role: PartnerRoleKey,
  permission: Permission,
): boolean {
  return PARTNER_ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}
