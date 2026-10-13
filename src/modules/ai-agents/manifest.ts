import { defineModuleManifest } from "@/core/module-contracts/manifest";

/** GUIDS per workspace (D-AG-16): 1 to 3 by plan, also with the customer key. */
export const AI_AGENTS_MAX_QUOTA = "ai-agents.max";

/**
 * Agentes de IA (GUIDS), especificação v1.0 em docs/modules/ai-agents. Fica
 * atrás da flag GUIDU_MODULE_AI_AGENTS_ENABLED até a A4 (ESTADO.md). As
 * permissões `ai_agents.*` estão no catálogo do núcleo.
 */
export const aiAgentsManifest = defineModuleManifest({
  moduleKey: "ai-agents",
  displayName: "Agentes de IA",
  description: "GUIDS: agentes de IA que atendem os contatos do workspace.",
  moduleVersion: "0.0.0",
  contractVersion: "1.0.0",
  platformCompatibility: { minPlatformVersion: "0.1.0" },
  // Beta atrás da trava técnica GUIDU_MODULE_AI_AGENTS_ENABLED (C04): com a
  // flag desligada, o módulo fica oculto e bloqueado em todas as entradas.
  releaseStatus: "beta",
  routes: [
    { routeKey: "ai-agents.home", destination: "app", path: "ai-agents" },
  ],
  navigation: [
    {
      id: "ai-agents",
      destination: "app",
      groupKey: "modules",
      label: "Agentes de IA",
      routeKey: "ai-agents.home",
      iconKey: "bot",
      order: 30,
      requiredPermissions: ["ai_agents.use"],
    },
  ],
  entitlements: [
    {
      key: AI_AGENTS_MAX_QUOTA,
      kind: "quota",
      description: "Agentes de IA (GUIDS) por workspace.",
      defaultLimit: 1,
    },
  ],
  // Export and purge of its rows (F3e): src/modules/ai-agents/data.ts.
  capabilities: ["export"],
});
