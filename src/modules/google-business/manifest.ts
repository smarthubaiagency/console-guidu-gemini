import { defineModuleManifest } from "@/core/module-contracts/manifest";

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
});
