import { defineModuleManifest } from "@/core/module-contracts/manifest";
import { Permissions } from "@/core/permissions/catalog";

import { InboxWorkspaceConfig } from "./settings";

/**
 * Módulo Inbox (IN4a, ADR 0023): o atendimento do comerciante em tela
 * cheia, como cliente Matrix. As permissões `inbox.*` são do núcleo
 * (catálogo da IN3); o manifesto só as referencia. Quem responde é quem
 * foi marcado como atendente (decisão de 17/10/2026); a cota conta os
 * marcados. Em Configurações › Módulos › Inbox (IN6), quem gerencia
 * escolhe o GUIDS que atende as conversas pendentes e as regras de
 * atendimento.
 */

/** Atendentes por workspace quando o plano não define limite (provisório). */
export const INBOX_DEFAULT_ATTENDANT_LIMIT = 5;

export const INBOX_ATTENDANTS_QUOTA = "inbox.attendants";

export const inboxManifest = defineModuleManifest({
  moduleKey: "inbox",
  displayName: "Inbox",
  description:
    "Atendimento das conversas do workspace, com visões, responsável e status.",
  moduleVersion: "0.1.0",
  contractVersion: "1.0.0",
  platformCompatibility: { minPlatformVersion: "0.1.0" },
  templateVersion: "1.0.0",
  releaseStatus: "beta",
  routes: [{ routeKey: "inbox.window", destination: "app", path: "inbox" }],
  navigation: [
    {
      id: "inbox",
      destination: "app",
      groupKey: "modules",
      label: "Inbox",
      iconKey: "inbox",
      order: 5,
      routeKey: "inbox.window",
      requiredPermissions: [Permissions.INBOX_VIEW],
    },
  ],
  settings: [
    {
      id: "inbox.workspace",
      destination: "workspace",
      label: "Inbox",
      order: 20,
      componentKey: "inbox.workspace-settings",
      readPermissions: [Permissions.INBOX_VIEW],
      writePermissions: [Permissions.INBOX_MANAGE],
    },
  ],
  configurationSchema: { workspace: InboxWorkspaceConfig },
  entitlements: [
    {
      key: INBOX_ATTENDANTS_QUOTA,
      kind: "quota",
      description: "Atendentes marcados por workspace.",
      defaultLimit: INBOX_DEFAULT_ATTENDANT_LIMIT,
    },
  ],
});
