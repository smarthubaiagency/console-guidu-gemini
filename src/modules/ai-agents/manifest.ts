import { defineModuleManifest } from "@/core/module-contracts/manifest";

/**
 * Agentes de IA — congelado pela C04 (ver docs/modules/ai-agents/ESTADO.md).
 * As permissões `ai_agents.*` continuam no catálogo do núcleo; a especificação
 * do módulo está em rascunho e não é preenchida aqui.
 */
export const aiAgentsManifest = defineModuleManifest({
  moduleKey: "ai-agents",
  displayName: "Agentes de IA",
  description:
    "Assistentes contextuais (congelado até a especificação ser aprovada).",
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
});
