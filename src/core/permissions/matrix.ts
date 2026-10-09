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
