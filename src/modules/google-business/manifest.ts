import { defineModuleManifest } from "@/core/module-contracts/manifest";

/**
 * Google Meu Negócio — Agente GMN (especificação em
 * docs/modules/google-business/especificacao.md). GB1a: onboarding
 * "Adicionar local" (ficha ligada a uma unidade, versão inicial, análises)
 * e a página de automação. Desligado por padrão
 * (`GUIDU_MODULE_GOOGLE_BUSINESS_ENABLED`) até o Marcelo liberar.
 */

export const GoogleBusinessPermissions = {
  READ: "google_business.read",
  MANAGE: "google_business.manage",
} as const;

export const googleBusinessManifest = defineModuleManifest({
  moduleKey: "google-business",
  displayName: "Google Meu Negócio",
  description:
    "Fichas do Google de cada unidade: análises, página de automação e agente especialista.",
  moduleVersion: "0.1.0",
  contractVersion: "1.0.0",
  platformCompatibility: { minPlatformVersion: "0.1.0" },
  templateVersion: "1.0.0",
  releaseStatus: "beta",
  routes: [
    {
      routeKey: "google-business.home",
      destination: "app",
      path: "google-business",
    },
    {
      routeKey: "google-business.location",
      destination: "app",
      path: "google-business/locations/[locationId]",
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
      requiredPermissions: [GoogleBusinessPermissions.READ],
    },
  ],
  permissions: [
    {
      key: GoogleBusinessPermissions.READ,
      description: "Acompanhar as fichas do Google e as análises.",
      defaultWorkspaceRoles: ["owner", "admin", "editor", "viewer"],
    },
    {
      key: GoogleBusinessPermissions.MANAGE,
      description: "Adicionar locais e configurar a automação das fichas.",
      defaultWorkspaceRoles: ["owner", "admin"],
    },
  ],
  capabilities: ["export"],
});
