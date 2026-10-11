/**
 * ============================================================================
 * File: src/core/mcp/scopes.ts
 * Module: MCP Scopes Catalog (ADR 0009, Specification §17.3)
 *
 * Maintenance Rationale:
 * - Specification §17.3: Canonical catalog of workspace MCP scopes:
 *   - workspace:read
 *   - modules:read
 *   - usage:read
 *   - executions:read
 *   - members:read
 *   - proposals:write
 * - Read-only by default: workspace:read + modules:read.
 * - proposals:write requires explicit opt-in and human approval notice.
 * - operations:execute is intentionally NOT issuable in this phase (§17.4).
 * - admin:* scopes are administrative surfaces (ADR 0009) and NOT issuable for workspaces.
 * ============================================================================
 */

import { z } from "zod";

export const WorkspaceScope = {
  WORKSPACE_READ: "workspace:read",
  MODULES_READ: "modules:read",
  USAGE_READ: "usage:read",
  EXECUTIONS_READ: "executions:read",
  MEMBERS_READ: "members:read",
  PROPOSALS_WRITE: "proposals:write",
  /** CRM module (F4c): read contacts; write them through the REST API. */
  CRM_READ: "crm:read",
  CRM_WRITE: "crm:write",
  /**
   * Portfolio module (F5d): the UCP catalog (`portfolio:read`), the view of
   * our service agent with AI governance and quote items
   * (`portfolio:agent`), and item writes through the REST API
   * (`portfolio:write`; the MCP writes through proposals).
   */
  PORTFOLIO_READ: "portfolio:read",
  PORTFOLIO_AGENT: "portfolio:agent",
  PORTFOLIO_WRITE: "portfolio:write",
} as const;

export const WORKSPACE_SCOPES = [
  WorkspaceScope.WORKSPACE_READ,
  WorkspaceScope.MODULES_READ,
  WorkspaceScope.USAGE_READ,
  WorkspaceScope.EXECUTIONS_READ,
  WorkspaceScope.MEMBERS_READ,
  WorkspaceScope.PROPOSALS_WRITE,
  WorkspaceScope.CRM_READ,
  WorkspaceScope.CRM_WRITE,
  WorkspaceScope.PORTFOLIO_READ,
  WorkspaceScope.PORTFOLIO_AGENT,
  WorkspaceScope.PORTFOLIO_WRITE,
] as const;

export const WorkspaceScopeSchema = z.enum([
  "workspace:read",
  "modules:read",
  "usage:read",
  "executions:read",
  "members:read",
  "proposals:write",
  "crm:read",
  "crm:write",
  "portfolio:read",
  "portfolio:agent",
  "portfolio:write",
]);

export type WorkspaceScopeType = z.infer<typeof WorkspaceScopeSchema>;

export const DEFAULT_WORKSPACE_SCOPES: readonly WorkspaceScopeType[] =
  Object.freeze([WorkspaceScope.WORKSPACE_READ, WorkspaceScope.MODULES_READ]);

export const READ_ONLY_SCOPES: readonly WorkspaceScopeType[] = Object.freeze([
  WorkspaceScope.WORKSPACE_READ,
  WorkspaceScope.MODULES_READ,
  WorkspaceScope.USAGE_READ,
  WorkspaceScope.EXECUTIONS_READ,
  WorkspaceScope.MEMBERS_READ,
  WorkspaceScope.CRM_READ,
  WorkspaceScope.PORTFOLIO_READ,
  WorkspaceScope.PORTFOLIO_AGENT,
]);

export const WRITE_SCOPES: readonly WorkspaceScopeType[] = Object.freeze([
  WorkspaceScope.PROPOSALS_WRITE,
  WorkspaceScope.CRM_WRITE,
  WorkspaceScope.PORTFOLIO_WRITE,
]);

export function isReadOnlyScope(scope: string): boolean {
  return (READ_ONLY_SCOPES as readonly string[]).includes(scope);
}

export function isWriteScope(scope: string): boolean {
  return (WRITE_SCOPES as readonly string[]).includes(scope);
}

export type ScopeDefinition = {
  id: WorkspaceScopeType;
  label: string;
  desc: string;
  isWrite?: boolean;
};

export const SCOPE_DEFINITIONS: readonly ScopeDefinition[] = [
  {
    id: "workspace:read",
    label: "Visão Geral do Workspace (workspace:read)",
    desc: "Acesso de leitura a informações básicas e visão geral do workspace.",
  },
  {
    id: "modules:read",
    label: "Estado dos Módulos (modules:read)",
    desc: "Consulta aos módulos habilitados e seus respectivos status operacionais.",
  },
  {
    id: "usage:read",
    label: "Consumo e Cotas (usage:read)",
    desc: "Visualização do sumário de consumo, sem acesso a segredos ou conteúdo restrito.",
  },
  {
    id: "executions:read",
    label: "Execuções e Jobs (executions:read)",
    desc: "Listagem e status de tarefas e execuções no workspace.",
  },
  {
    id: "members:read",
    label: "Lista de Membros (members:read)",
    desc: "Consulta aos membros e vínculos associados ao workspace.",
  },
  {
    id: "proposals:write",
    label: "Escrita de Propostas (proposals:write)",
    desc: "Permite ao assistente criar propostas operacionais sujeitas à aprovação humana.",
    isWrite: true,
  },
  {
    id: "crm:read",
    label: "Contatos do CRM (crm:read)",
    desc: "Leitura dos contatos do módulo CRM, quando o módulo está habilitado.",
  },
  {
    id: "crm:write",
    label: "Escrita de contatos do CRM (crm:write)",
    desc: "Criar e editar contatos pela API REST. No MCP, a escrita passa por proposta.",
    isWrite: true,
  },
  {
    id: "portfolio:read",
    label: "Catálogo do Portfólio (portfolio:read)",
    desc: "Busca e consulta dos itens no formato UCP (search_catalog, lookup_catalog, get_product). Só itens ativos, públicos e com preço.",
  },
  {
    id: "portfolio:agent",
    label: "Portfólio para o agente de atendimento (portfolio:agent)",
    desc: "Visão do agente: inclui itens sob consulta e as regras da IA (palavras-chave, o que nunca dizer, segurança).",
  },
  {
    id: "portfolio:write",
    label: "Escrita no Portfólio (portfolio:write)",
    desc: "Criar e editar itens e variantes pela API REST. No MCP, a escrita passa por proposta.",
    isWrite: true,
  },
];
