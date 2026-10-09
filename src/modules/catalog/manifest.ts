import { defineModuleManifest } from "@/core/module-contracts/manifest";

/**
 * Catálogo — metadados de entrada apenas. Conteúdo, campos e regras do módulo
 * continuam em aberto (Especificação §14); nada aqui define funcionalidade.
 */
export const catalogManifest = defineModuleManifest({
  moduleKey: "catalog",
  displayName: "Catálogo",
  description: "Gestão de sortimento e produtos (especificação em aberto).",
  moduleVersion: "0.0.0",
  contractVersion: "1.0.0",
  platformCompatibility: { minPlatformVersion: "0.1.0" },
  releaseStatus: "coming_soon",
  routes: [{ routeKey: "catalog.home", destination: "app", path: "catalog" }],
  navigation: [
    {
      id: "catalog",
      destination: "app",
      groupKey: "modules",
      label: "Catálogo",
      routeKey: "catalog.home",
      iconKey: "shopping-bag",
      order: 10,
    },
  ],
});
