import { defineModuleManifest } from "@/core/module-contracts/manifest";

import { MAPS_QUOTA_DEFAULTS, MapsQuotas } from "./maps/quotas";

/**
 * Google Business — metadados de entrada apenas. Operações, métricas e regras
 * continuam em aberto (Especificação §14).
 */
export const googleBusinessManifest = defineModuleManifest({
  moduleKey: "google-business",
  displayName: "Google Meu Negócio",
  description:
    "Integração e sincronização de perfis comerciais (especificação em aberto).",
  moduleVersion: "0.0.0",
  contractVersion: "1.0.0",
  platformCompatibility: { minPlatformVersion: "0.1.0" },
  releaseStatus: "coming_soon",
  routes: [
    {
      routeKey: "google-business.home",
      destination: "app",
      path: "google-business",
    },
  ],
  navigation: [
    {
      id: "google-business",
      destination: "app",
      groupKey: "modules",
      label: "Google Meu Negócio",
      routeKey: "google-business.home",
      iconKey: "store",
      order: 20,
    },
  ],
  // Saúde no Maps (GB1b): per unit; the starting point does not count.
  entitlements: [
    {
      key: MapsQuotas.KEYWORDS,
      kind: "quota",
      description: "Palavras-chave monitoradas no mapa por unidade.",
      defaultLimit: MAPS_QUOTA_DEFAULTS.keywords,
    },
    {
      key: MapsQuotas.GRID_SIZE,
      kind: "quota",
      description: "Pontos por lado da grade do mapa (7 = 7x7).",
      defaultLimit: MAPS_QUOTA_DEFAULTS.gridSize,
    },
    {
      key: MapsQuotas.SCANS_PER_MONTH,
      kind: "quota",
      description: "Medições do mapa por unidade por mês.",
      defaultLimit: MAPS_QUOTA_DEFAULTS.scansPerMonth,
    },
  ],
  capabilities: ["export"],
});
