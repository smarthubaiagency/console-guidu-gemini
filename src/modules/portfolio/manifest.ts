import { z } from "zod";

import { defineModuleManifest } from "@/core/module-contracts/manifest";

/**
 * Módulo Portfólio (F5, antes "Catálogo"): produtos, serviços, imóveis,
 * hospedagem e eventos do workspace, com os campos do Universal Commerce
 * Protocol (docs/modules/portfolio). É a ferramenta do agente de
 * atendimento e a fonte do commerce agentic e do Google.
 */

/** Limites quando nem o plano nem a plataforma definem (provisórios). */
export const PORTFOLIO_DEFAULT_ITEM_LIMIT = 1000;
export const PORTFOLIO_DEFAULT_VARIANT_LIMIT = 10000;

export const PortfolioQuotas = {
  ITEMS: "portfolio.items",
  VARIANTS: "portfolio.variants",
} as const;

export const PortfolioPermissions = {
  ITEMS_READ: "portfolio.items.read",
  ITEMS_WRITE: "portfolio.items.write",
} as const;

/**
 * Configuração global (Plataforma › Configurações de módulos › Portfólio):
 * limites padrão para empresas sem limite no plano.
 */
export const portfolioAdminConfigSchema = z
  .object({
    quotaDefaults: z
      .object({
        [PortfolioQuotas.ITEMS]: z.number().int().min(0).max(1_000_000),
        [PortfolioQuotas.VARIANTS]: z.number().int().min(0).max(10_000_000),
      })
      .partial()
      .strict()
      .optional(),
  })
  .strict();

export const portfolioManifest = defineModuleManifest({
  moduleKey: "portfolio",
  displayName: "Portfólio",
  description:
    "Produtos, serviços, imóveis, hospedagem e eventos no formato do protocolo UCP.",
  moduleVersion: "0.1.0",
  contractVersion: "1.0.0",
  platformCompatibility: { minPlatformVersion: "0.1.0" },
  templateVersion: "1.0.0",
  releaseStatus: "beta",
  routes: [
    { routeKey: "portfolio.items", destination: "app", path: "portfolio" },
    {
      routeKey: "portfolio.item",
      destination: "app",
      path: "portfolio/[itemId]",
    },
  ],
  navigation: [
    {
      id: "portfolio",
      destination: "app",
      groupKey: "modules",
      label: "Portfólio",
      routeKey: "portfolio.items",
      iconKey: "shopping-bag",
      order: 10,
      requiredPermissions: [PortfolioPermissions.ITEMS_READ],
    },
  ],
  settings: [
    {
      id: "portfolio.admin",
      destination: "admin",
      label: "Portfólio",
      order: 10,
      componentKey: "portfolio.admin-settings",
      readPermissions: ["platform.modules.read"],
      writePermissions: ["platform.modules.manage"],
    },
  ],
  permissions: [
    {
      key: PortfolioPermissions.ITEMS_READ,
      description: "Ver os itens do portfólio.",
      defaultWorkspaceRoles: ["owner", "admin", "editor", "viewer"],
    },
    {
      key: PortfolioPermissions.ITEMS_WRITE,
      description: "Criar e editar itens e variantes do portfólio.",
      defaultWorkspaceRoles: ["owner", "admin", "editor"],
    },
  ],
  entitlements: [
    {
      key: PortfolioQuotas.ITEMS,
      kind: "quota",
      description: "Itens do portfólio por workspace.",
      defaultLimit: PORTFOLIO_DEFAULT_ITEM_LIMIT,
    },
    {
      key: PortfolioQuotas.VARIANTS,
      kind: "quota",
      description: "Variantes do portfólio por workspace.",
      defaultLimit: PORTFOLIO_DEFAULT_VARIANT_LIMIT,
    },
  ],
  configurationSchema: { admin: portfolioAdminConfigSchema },
  capabilities: ["settings", "export", "api", "mcp"],
});
