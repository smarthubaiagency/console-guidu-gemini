/**
 * ============================================================================
 * File: src/core/module-runtime/navigation.ts
 * Module: Generated Navigation (Adendo §8.1)
 *
 * Maintenance Rationale:
 * - Builds the app and platform (/platform) navigation trees from core entries plus the
 *   registered manifests. Layouts render this tree; no layout keeps its own
 *   hand-written module list.
 * - App: state (gate, global availability, release, workspace enablement) and
 *   permissions of the active identity decide what appears. Items without
 *   access and groups without visible children are removed.
 * - Admin: internal role permissions and presence in the registry decide;
 *   global settings stay reachable during maintenance (Adendo §8.1).
 * - Output is a plain DTO (labels, hrefs, icon keys): no component, server
 *   code or secret reaches the browser bundle through navigation.
 * ============================================================================
 */

import "server-only";

import type { ModuleIconKey } from "@/core/module-contracts/manifest";
import {
  type CompanyContract,
  LEGACY_CONTRACT,
} from "@/core/entitlements/types";
import type { PermissionKey } from "@/core/permissions/catalog";
import type { RegisteredModule } from "@/modules/registry";

import {
  moduleStateLabel,
  contractAccessFor,
  resolveModuleAccessState,
  type PlatformModuleState,
  type WorkspaceModuleState,
} from "./state";

export type NavIconKey =
  | ModuleIconKey
  | "activity"
  | "code"
  | "credit-card"
  | "gauge"
  | "key"
  | "layers"
  | "play-circle"
  | "plug"
  | "scroll-text"
  | "inbox"
  | "map-pin"
  | "building"
  | "handshake"
  | "palette"
  | "languages"
  | "globe"
  | "mail"
  | "shield"
  | "users";

export type NavItem = Readonly<{
  id: string;
  label: string;
  /** Null for an entry that only groups its children. */
  href: string | null;
  iconKey: NavIconKey | null;
  badge: string | null;
  /** Active only on an exact path match (dashboards). */
  exact: boolean;
  children: readonly NavItem[];
  /**
   * The sidebar shows the entry alone: its children are the settings
   * submenu, drawn inside the page (CF1). Breadcrumb and search still list
   * them.
   */
  hideChildren: boolean;
}>;

export type NavSection = Readonly<{
  id: string;
  label: string;
  items: readonly NavItem[];
}>;

type Grants = (permission: PermissionKey) => boolean;

function allGranted(permissions: readonly string[], grants: Grants): boolean {
  return permissions.every((permission) => grants(permission as PermissionKey));
}

function byOrder<T extends { order: number; id: string }>(a: T, b: T): number {
  return a.order - b.order || a.id.localeCompare(b.id);
}

function routePath(
  mod: RegisteredModule,
  routeKey: string | undefined,
): string | null {
  if (!routeKey) return null;
  return (
    mod.manifest.routes.find((route) => route.routeKey === routeKey)?.path ??
    null
  );
}

function item(
  partial: Pick<NavItem, "id" | "label" | "href" | "iconKey"> &
    Partial<NavItem>,
): NavItem {
  return {
    badge: null,
    exact: false,
    children: [],
    hideChildren: false,
    ...partial,
  };
}

/**
 * Sidebar entry of a settings area (CF1): one link to the area, whose
 * groups are drawn as the submenu card of the settings pages.
 */
function settingsEntry(
  id: string,
  href: string,
  sections: readonly NavSection[],
): NavItem[] {
  const children = sections.flatMap((section) => section.items);
  if (children.length === 0) return [];
  return [
    item({
      id,
      label: "Configurações",
      href,
      iconKey: "settings",
      children,
      hideChildren: true,
    }),
  ];
}

export type AppNavigationInput = Readonly<{
  workspaceSlug: string;
  modules: readonly RegisteredModule[];
  platformStates: ReadonlyMap<string, PlatformModuleState>;
  workspaceStates: ReadonlyMap<string, WorkspaceModuleState>;
  grants: Grants;
  /** The company's plan contract (F3b); legacy when absent. */
  contract?: CompanyContract;
}>;

/** Module entries of the app sidebar, already filtered and sorted. */
export function buildAppModuleItems(input: AppNavigationInput): NavItem[] {
  const base = `/app/${input.workspaceSlug}`;
  const entries: Array<{ order: number; id: string; value: NavItem }> = [];

  for (const mod of input.modules) {
    const state = resolveModuleAccessState(
      mod,
      input.platformStates.get(mod.manifest.moduleKey),
      input.workspaceStates.get(mod.manifest.moduleKey),
      contractAccessFor(
        input.contract ?? LEGACY_CONTRACT,
        mod.manifest.moduleKey,
      ),
    );
    if (
      state === "hidden" ||
      state === "not_enabled" ||
      state === "not_contracted"
    ) {
      continue;
    }

    for (const entry of mod.manifest.navigation) {
      if (entry.destination !== "app") continue;
      if (!allGranted(entry.requiredPermissions, input.grants)) continue;

      const parentPath = routePath(mod, entry.routeKey);
      const operational = state === "enabled" || state === "suspended";
      const children = operational
        ? [...entry.children]
            .sort(byOrder)
            .filter((child) =>
              allGranted(child.requiredPermissions, input.grants),
            )
            .flatMap((child) => {
              const path = routePath(mod, child.routeKey);
              return path
                ? [
                    item({
                      id: child.id,
                      label: child.label,
                      href: `${base}/${path}`,
                      iconKey: child.iconKey ?? null,
                    }),
                  ]
                : [];
            })
        : [];

      // A coming-soon or maintenance module keeps one entry pointing at its
      // landing route; a group without visible children disappears.
      const firstChildHref = entry.children
        .map((child) => routePath(mod, child.routeKey))
        .find((path) => path !== null);
      const href = parentPath
        ? `${base}/${parentPath}`
        : operational
          ? null
          : firstChildHref
            ? `${base}/${firstChildHref}`
            : null;
      if (!href && children.length === 0) continue;

      const badge =
        state === "enabled" && mod.manifest.releaseStatus === "available"
          ? null
          : moduleStateLabel(state, mod.manifest.releaseStatus);

      entries.push({
        order: entry.order,
        id: entry.id,
        value: item({
          id: entry.id,
          label: entry.label,
          href,
          iconKey: entry.iconKey ?? null,
          badge,
          children,
        }),
      });
    }
  }

  return entries.sort(byOrder).map((entry) => entry.value);
}

/** Workspace settings entries contributed by enabled modules. */
export function buildAppModuleSettingsItems(
  input: AppNavigationInput,
): NavItem[] {
  const base = `/app/${input.workspaceSlug}/settings/modules`;
  const entries: Array<{ order: number; id: string; value: NavItem }> = [];

  for (const mod of input.modules) {
    const state = resolveModuleAccessState(
      mod,
      input.platformStates.get(mod.manifest.moduleKey),
      input.workspaceStates.get(mod.manifest.moduleKey),
      contractAccessFor(
        input.contract ?? LEGACY_CONTRACT,
        mod.manifest.moduleKey,
      ),
    );
    if (
      state !== "enabled" &&
      state !== "maintenance" &&
      state !== "suspended"
    ) {
      continue;
    }

    for (const entry of mod.manifest.settings) {
      if (entry.destination !== "workspace") continue;
      if (!allGranted(entry.readPermissions, input.grants)) continue;
      entries.push({
        order: entry.order,
        id: entry.id,
        value: item({
          id: entry.id,
          label: entry.label,
          href: `${base}/${mod.manifest.moduleKey}`,
          iconKey: null,
        }),
      });
    }
  }

  return entries.sort(byOrder).map((entry) => entry.value);
}

/** Full app sidebar: core entries around the module contributions. */
export function buildAppNavigation(input: AppNavigationInput): NavSection[] {
  const base = `/app/${input.workspaceSlug}`;
  return [
    {
      id: "platform",
      label: "Plataforma",
      items: [
        item({
          id: "core.overview",
          label: "Visão Geral",
          href: base,
          iconKey: "layout-dashboard",
          exact: true,
        }),
        ...buildAppModuleItems(input),
        item({
          id: "core.executions",
          label: "Execuções",
          href: `${base}/executions`,
          iconKey: "play-circle",
        }),
        // Proposals of the assistants waiting for a person (F4d): owner/admin.
        ...(input.grants("workspace.proposals.review")
          ? [
              item({
                id: "core.proposals",
                label: "Propostas",
                href: `${base}/proposals`,
                iconKey: "inbox",
              }),
            ]
          : []),
        ...settingsEntry(
          "core.settings",
          `${base}/settings`,
          buildAppSettingsNavigation(input),
        ),
      ],
    },
  ];
}

/**
 * Settings submenu of the workspace (/app/[slug]/settings, CF1): groups of
 * the proposal in menus-admin-app.md, each entry behind its grant.
 */
export function buildAppSettingsNavigation(
  input: AppNavigationInput,
): NavSection[] {
  const base = `/app/${input.workspaceSlug}/settings`;
  const sections: NavSection[] = [
    {
      id: "settings.workspace",
      label: "Workspace",
      items: [
        item({
          id: "core.general",
          label: "Geral",
          href: `${base}/general`,
          iconKey: "settings",
        }),
        // Public domains of the workspace (CF2b): every member reads.
        item({
          id: "core.domains",
          label: "Domínios",
          href: `${base}/domains`,
          iconKey: "globe",
        }),
        // Stores of the business (F5a, UCP Location): every member sees.
        item({
          id: "core.locations",
          label: "Lojas",
          href: `${base}/locations`,
          iconKey: "map-pin",
        }),
        item({
          id: "core.team",
          label: "Equipe & Membros",
          href: `${base}/team`,
          iconKey: "users",
        }),
      ],
    },
    {
      id: "settings.channels",
      label: "Canais e integrações",
      items: [
        // Messaging channels (A5a, ADR 0011): owner, admin and editor.
        ...(input.grants("channels.read")
          ? [
              item({
                id: "core.channels",
                label: "Canais",
                href: `${base}/channels`,
                iconKey: "inbox",
              }),
            ]
          : []),
        // The workspace's Google account (CF6b): owner and admin.
        ...(input.grants("workspace.settings.update")
          ? [
              item({
                id: "core.integrations",
                label: "Integrações",
                href: `${base}/integrations`,
                iconKey: "plug",
              }),
            ]
          : []),
        item({
          id: "core.credentials",
          label: "Credenciais BYOK",
          href: `${base}/credentials`,
          iconKey: "key",
        }),
        item({
          id: "core.mcp",
          label: "Assistentes MCP",
          href: `${base}/mcp`,
          iconKey: "bot",
        }),
        item({
          id: "core.api",
          label: "API e Webhooks",
          href: `${base}/api`,
          iconKey: "code",
        }),
      ],
    },
    {
      id: "settings.plan",
      label: "Plano",
      items: [
        // Plan and billing state of the company (P5m): owner/admin.
        ...(input.grants("workspace.settings.update")
          ? [
              item({
                id: "core.billing",
                label: "Plano e cobrança",
                href: `${base}/billing`,
                iconKey: "credit-card",
              }),
            ]
          : []),
        item({
          id: "core.usage",
          label: "Consumo & Limites",
          href: `${base}/usage`,
          iconKey: "gauge",
        }),
        item({
          id: "core.modules",
          label: "Módulos",
          href: `${base}/modules`,
          iconKey: "puzzle",
          exact: true,
          children: buildAppModuleSettingsItems(input),
        }),
      ],
    },
    {
      id: "settings.system",
      label: "Sistema",
      items: [
        // MFA required of the team (CF5a): every member reads, owner/admin edit.
        item({
          id: "core.security",
          label: "Segurança",
          href: `${base}/security`,
          iconKey: "shield",
        }),
        // Export and deletion of the workspace (F3e): owner/admin.
        ...(input.grants("workspace.data.export") ||
        input.grants("workspace.delete")
          ? [
              item({
                id: "core.data",
                label: "Dados e privacidade",
                href: `${base}/data`,
                iconKey: "file-text",
              }),
            ]
          : []),
        // Temporary partner support access (ADR 0012, P4b2): owner/admin.
        ...(input.grants("workspace.members.manage")
          ? [
              item({
                id: "core.support",
                label: "Acesso de suporte",
                href: `${base}/support`,
                iconKey: "hand",
              }),
            ]
          : []),
      ],
    },
  ];
  return sections.filter((section) => section.items.length > 0);
}

export type PlatformNavigationInput = Readonly<{
  modules: readonly RegisteredModule[];
  grants: Grants;
}>;

/** Platform console sidebar (/platform): core entries plus global module settings. */
export function buildPlatformNavigation(
  input: PlatformNavigationInput,
): NavSection[] {
  const canReadModules = input.grants("platform.modules.read");
  const canReadPartners = input.grants("platform.partners.read");
  const canManageLegal = input.grants("platform.legal.manage");
  const canReadBilling = input.grants("platform.billing.read");
  const canReadOperations = input.grants("platform.operations.read");
  const canReadEvents = input.grants("platform.events.read");
  // AI of the house (A3a): templates and backup key, behind the module flag.
  const canManageAi =
    input.grants("platform.ai.manage") &&
    input.modules.some(
      (mod) => mod.manifest.moduleKey === "ai-agents" && mod.technicalGate(),
    );

  return [
    {
      id: "platform",
      label: "Administração",
      items: [
        item({
          id: "platform.overview",
          label: "Visão Geral",
          href: "/platform",
          iconKey: "layout-dashboard",
          exact: true,
        }),
        item({
          id: "platform.customers",
          label: "Clientes / Empresas",
          href: "/platform/customers",
          iconKey: "building",
        }),
        item({
          id: "platform.workspaces",
          label: "Workspaces",
          href: "/platform/workspaces",
          iconKey: "layers",
        }),
        item({
          id: "platform.users",
          label: "Usuários da Plataforma",
          href: "/platform/users",
          iconKey: "users",
        }),
        ...(canReadModules
          ? [
              item({
                id: "platform.modules",
                label: "Módulos",
                href: "/platform/modules",
                iconKey: "puzzle",
              }),
            ]
          : []),
        ...(canReadPartners
          ? [
              item({
                id: "platform.partners",
                label: "Parceiros",
                href: "/platform/partners",
                iconKey: "handshake",
              }),
            ]
          : []),
        ...(canReadBilling
          ? [
              // Visão geral and Gateway (CF7), drawn as tabs of the page;
              // the children feed the breadcrumb and search.
              item({
                id: "platform.billing",
                label: "Cobrança",
                href: "/platform/billing",
                iconKey: "credit-card",
                hideChildren: true,
                children: [
                  item({
                    id: "platform.billing.overview",
                    label: "Visão geral",
                    href: "/platform/billing",
                    iconKey: "credit-card",
                    exact: true,
                  }),
                  ...(input.grants("platform.billing.manage")
                    ? [
                        item({
                          id: "platform.billing.gateway",
                          label: "Gateway",
                          href: "/platform/billing/gateway",
                          iconKey: "credit-card",
                        }),
                      ]
                    : []),
                ],
              }),
            ]
          : []),
        ...(canReadOperations
          ? [
              // Saúde e filas (F3d) and Manutenção (CF5c), drawn as tabs
              // of the page; the children feed the breadcrumb and search.
              item({
                id: "platform.operations",
                label: "Operações",
                href: "/platform/operations",
                iconKey: "activity",
                hideChildren: true,
                children: [
                  item({
                    id: "platform.operations.health",
                    label: "Saúde e filas",
                    href: "/platform/operations",
                    iconKey: "activity",
                    exact: true,
                  }),
                  item({
                    id: "platform.operations.maintenance",
                    label: "Manutenção",
                    href: "/platform/operations/maintenance",
                    iconKey: "activity",
                  }),
                ],
              }),
            ]
          : []),
        // Central de Eventos (H1): the situation of every event; billing
        // sees the billing ones only.
        ...(canReadEvents
          ? [
              item({
                id: "platform.events",
                label: "Eventos",
                href: "/platform/events",
                iconKey: "inbox",
              }),
            ]
          : []),
        // The whole audit trail (AUD1): every internal role; the database
        // narrows billing to the billing actions.
        ...(input.grants("platform.audit.read")
          ? [
              item({
                id: "platform.audit",
                label: "Auditoria",
                href: "/platform/audit",
                iconKey: "scroll-text",
              }),
            ]
          : []),
        // Administrative keys of the platform API and MCP (F4e): every
        // internal role member creates their own.
        item({
          id: "platform.api-keys",
          label: "Chaves de API",
          href: "/platform/api-keys",
          iconKey: "key",
        }),
        ...(canManageAi
          ? [
              // IA (CF6a): Painel, Provedores e modelos, Modelos de agente
              // and Chave reserva, drawn as tabs of the page; the children
              // feed the breadcrumb and search.
              item({
                id: "platform.ai",
                label: "IA",
                href: "/platform/ai",
                iconKey: "bot",
                hideChildren: true,
                children: [
                  item({
                    id: "platform.ai.dashboard",
                    label: "Painel",
                    href: "/platform/ai",
                    iconKey: "bot",
                    exact: true,
                  }),
                  item({
                    id: "platform.ai.providers",
                    label: "Provedores e modelos",
                    href: "/platform/ai/providers",
                    iconKey: "bot",
                  }),
                  item({
                    id: "platform.ai.templates",
                    label: "Modelos de agente",
                    href: "/platform/ai/templates",
                    iconKey: "bot",
                  }),
                  item({
                    id: "platform.ai.backup",
                    label: "Chave reserva",
                    href: "/platform/ai/backup",
                    iconKey: "bot",
                  }),
                ],
              }),
            ]
          : []),
        ...(canManageLegal
          ? [
              item({
                id: "platform.legal",
                label: "Termos e privacidade",
                href: "/platform/legal",
                iconKey: "file-text",
              }),
            ]
          : []),
        // Interface patterns (U2a and ADR 0016): every internal role.
        ...(canReadModules
          ? [
              item({
                id: "platform.design",
                label: "Padrões de interface",
                href: null,
                iconKey: "layers",
                children: [
                  item({
                    id: "platform.design.workbench",
                    label: "Janela de edição",
                    href: "/platform/design/workbench",
                    iconKey: "layers",
                  }),
                  item({
                    id: "platform.design.status",
                    label: "Avisos",
                    href: "/platform/design/status",
                    iconKey: "layers",
                  }),
                  item({
                    id: "platform.design.components",
                    label: "Componentes",
                    href: "/platform/design/components",
                    iconKey: "layers",
                  }),
                  item({
                    id: "platform.design.example",
                    label: "Página modelo",
                    href: "/platform/design/example",
                    iconKey: "layers",
                  }),
                  item({
                    id: "platform.design.maps",
                    label: "Saúde no Maps",
                    href: "/platform/design/maps",
                    iconKey: "layers",
                  }),
                ],
              }),
            ]
          : []),
        ...settingsEntry(
          "platform.settings",
          "/platform/settings",
          buildPlatformSettingsNavigation(input),
        ),
      ],
    },
  ];
}

/**
 * Settings submenu of the platform (/platform/settings, CF1): the general
 * and regional defaults, the brand (CF2), the languages of the dashboard
 * (I1), plans and limits (CF4) and the global settings of each module.
 */
export function buildPlatformSettingsNavigation(
  input: PlatformNavigationInput,
): NavSection[] {
  const moduleItems = input.modules
    .filter((mod) => mod.technicalGate())
    .flatMap((mod) =>
      mod.manifest.settings
        .filter((entry) => entry.destination === "admin")
        .filter((entry) => allGranted(entry.readPermissions, input.grants))
        .map((entry) => ({
          order: entry.order,
          id: entry.id,
          value: item({
            id: entry.id,
            label: entry.label,
            href: `/platform/settings/modules/${mod.manifest.moduleKey}`,
            iconKey: null,
          }),
        })),
    )
    .sort(byOrder)
    .map((entry) => entry.value);
  const sections: NavSection[] = [
    {
      id: "settings.platform",
      label: "Plataforma",
      items: [
        item({
          id: "platform.settings.general",
          label: "Geral e região",
          href: "/platform/settings/general",
          iconKey: "settings",
        }),
        ...(input.grants("platform.brand.manage")
          ? [
              item({
                id: "platform.brand",
                label: "Marca",
                href: "/platform/settings/brand",
                iconKey: "palette",
              }),
            ]
          : []),
        ...(input.grants("platform.settings.manage")
          ? [
              item({
                id: "platform.settings.email",
                label: "E-mail",
                href: "/platform/settings/email",
                iconKey: "mail",
              }),
              // Subject and body of each event (CF3b).
              item({
                id: "platform.settings.email.templates",
                label: "Modelos de e-mail",
                href: "/platform/settings/email/templates",
                iconKey: "file-text",
              }),
            ]
          : []),
        ...(input.grants("platform.languages.manage")
          ? [
              item({
                id: "platform.languages",
                label: "Idiomas",
                href: "/platform/settings/languages",
                iconKey: "languages",
              }),
            ]
          : []),
        // Quota catalog, ceilings and plan values (CF4): billing readers.
        ...(input.grants("platform.billing.read")
          ? [
              item({
                id: "platform.settings.plans",
                label: "Planos e limites",
                href: "/platform/settings/plans",
                iconKey: "gauge",
              }),
            ]
          : []),
      ],
    },
    {
      id: "settings.system",
      label: "Sistema",
      items: [
        // Access (MFA, IP list), password and session, events (CF5a).
        ...(input.grants("platform.security.read")
          ? [
              item({
                id: "platform.settings.security",
                label: "Segurança",
                href: "/platform/settings/security",
                iconKey: "shield",
              }),
              item({
                id: "platform.settings.security.events",
                label: "Eventos de segurança",
                href: "/platform/settings/security/events",
                iconKey: "activity",
              }),
              // Sign-up, e-mail verification, Google and link (CF5b).
              item({
                id: "platform.settings.authentication",
                label: "Autenticação",
                href: "/platform/settings/authentication",
                iconKey: "key",
              }),
            ]
          : []),
        // Product analytics, off by default (CF7, D-PA-06).
        ...(input.grants("platform.settings.manage")
          ? [
              item({
                id: "platform.settings.analytics",
                label: "Analytics",
                href: "/platform/settings/analytics",
                iconKey: "activity",
              }),
            ]
          : []),
      ],
    },
    // API and integrations (CF6b): the settings managers.
    {
      id: "settings.integrations",
      label: "API e integrações",
      items: [
        ...(input.grants("platform.settings.manage")
          ? [
              item({
                id: "platform.settings.api",
                label: "API e MCP",
                href: "/platform/settings/api",
                iconKey: "code",
              }),
              item({
                id: "platform.settings.integrations.google",
                label: "Google",
                href: "/platform/settings/integrations/google",
                iconKey: "plug",
              }),
            ]
          : []),
      ],
    },
    { id: "settings.modules", label: "Módulos", items: moduleItems },
  ];
  return sections.filter((section) => section.items.length > 0);
}

/**
 * Partner console sidebar (/admin, ADR 0012): driven by partner grants. The
 * AI screens (A3b and A3c) also need the module flag, passed by the layout.
 */
export function buildPartnerNavigation(
  grants: Grants,
  options: Readonly<{ aiAgents?: boolean }> = {},
): NavSection[] {
  const aiItems = options.aiAgents
    ? [
        ...(grants("partner.ai_agents.read")
          ? [
              // Usage and errors of the customers (CF6a).
              item({
                id: "partner.ai.dashboard",
                label: "Painel de IA",
                href: "/admin/ai",
                iconKey: "bot",
                exact: true,
              }),
              item({
                id: "partner.ai.assistant",
                label: "Assistente GUIDU",
                href: "/admin/ai/assistant",
                iconKey: "bot",
              }),
              item({
                id: "partner.ai.guids",
                label: "GUIDS dos clientes",
                href: "/admin/ai/guids",
                iconKey: "bot",
              }),
              // Providers and models offered to the customers (CF6a);
              // read-only without partner.ai_agents.manage.
              item({
                id: "partner.ai.providers",
                label: "Provedores e modelos",
                href: "/admin/ai/providers",
                iconKey: "bot",
              }),
            ]
          : []),
        ...(grants("partner.ai_agents.manage")
          ? [
              item({
                id: "partner.ai.keys",
                label: "Chaves de IA",
                href: "/admin/ai/keys",
                iconKey: "bot",
              }),
              item({
                id: "partner.ai.templates",
                label: "Modelos de agente",
                href: "/admin/ai/templates",
                iconKey: "bot",
              }),
            ]
          : []),
      ]
    : [];
  return [
    {
      id: "partner",
      label: "Parceiro",
      items: [
        item({
          id: "partner.overview",
          label: "Visão Geral",
          href: "/admin",
          iconKey: "layout-dashboard",
          exact: true,
        }),
        ...(grants("partner.customers.read")
          ? [
              item({
                id: "partner.customers",
                label: "Clientes",
                href: "/admin/customers",
                iconKey: "building",
              }),
            ]
          : []),
        ...(grants("partner.customers.manage")
          ? [
              item({
                id: "partner.modules",
                label: "Módulos oferecidos",
                href: "/admin/modules",
                iconKey: "puzzle",
              }),
              item({
                id: "partner.templates",
                label: "Modelos de workspace",
                href: "/admin/templates",
                iconKey: "layers",
              }),
            ]
          : []),
        ...(aiItems.length > 0
          ? [
              item({
                id: "partner.ai",
                label: "Agentes de IA",
                href: null,
                iconKey: "bot",
                children: aiItems,
              }),
            ]
          : []),
        ...(grants("partner.billing.read")
          ? [
              item({
                id: "partner.billing",
                label: "Cobrança",
                href: "/admin/billing",
                iconKey: "credit-card",
              }),
            ]
          : []),
        ...(grants("partner.support.request")
          ? [
              item({
                id: "partner.support",
                label: "Acesso de suporte",
                href: "/admin/support",
                iconKey: "hand",
              }),
            ]
          : []),
        ...(grants("partner.legal.manage")
          ? [
              item({
                id: "partner.legal",
                label: "Termos e privacidade",
                href: "/admin/legal",
                iconKey: "file-text",
              }),
            ]
          : []),
        ...(grants("partner.read")
          ? [
              item({
                id: "partner.members",
                label: "Membros",
                href: "/admin/members",
                iconKey: "users",
              }),
            ]
          : []),
        ...settingsEntry(
          "partner.settings",
          "/admin/settings",
          buildPartnerSettingsNavigation(grants),
        ),
      ],
    },
  ];
}

/**
 * Settings submenu of the partner (/admin/settings, CF1): what the partner
 * sets for its customers and its brand (CF2). Every partner role reads; owner and admin edit.
 */
export function buildPartnerSettingsNavigation(grants: Grants): NavSection[] {
  const sections: NavSection[] = [
    {
      id: "settings.partner",
      label: "Parceiro",
      items: [
        ...(grants("partner.read")
          ? [
              item({
                id: "partner.settings.general",
                label: "Geral e região",
                href: "/admin/settings/general",
                iconKey: "settings",
              }),
            ]
          : []),
        ...(grants("partner.brand.manage")
          ? [
              item({
                id: "partner.brand",
                label: "Marca",
                href: "/admin/settings/brand",
                iconKey: "palette",
              }),
            ]
          : []),
        // Dashboard domain and customers' public domains (CF2b).
        ...(grants("partner.read")
          ? [
              item({
                id: "partner.settings.domains",
                label: "Domínios",
                href: "/admin/settings/domains",
                iconKey: "globe",
              }),
            ]
          : []),
        ...(grants("partner.read")
          ? [
              item({
                id: "partner.settings.email",
                label: "E-mail",
                href: "/admin/settings/email",
                iconKey: "mail",
              }),
            ]
          : []),
        // Templates for the partner's customers (CF3b): owner and admin.
        ...(grants("partner.settings.manage")
          ? [
              item({
                id: "partner.settings.email.templates",
                label: "Modelos de e-mail",
                href: "/admin/settings/email/templates",
                iconKey: "file-text",
              }),
            ]
          : []),
        // Limits of the plans the partner sells, read only (CF4).
        ...(grants("partner.read")
          ? [
              item({
                id: "partner.settings.plans",
                label: "Planos e limites",
                href: "/admin/settings/plans",
                iconKey: "gauge",
              }),
            ]
          : []),
      ],
    },
    // Google app of the partner and scopes for its customers (CF6b).
    {
      id: "settings.integrations",
      label: "Integrações",
      items: [
        ...(grants("partner.read")
          ? [
              item({
                id: "partner.settings.integrations",
                label: "Google",
                href: "/admin/settings/integrations",
                iconKey: "plug",
              }),
            ]
          : []),
      ],
    },
    {
      id: "settings.system",
      label: "Sistema",
      items: [
        // MFA of the customers, IP list of /admin and events (CF5a).
        ...(grants("partner.security.read")
          ? [
              item({
                id: "partner.settings.security",
                label: "Segurança",
                href: "/admin/settings/security",
                iconKey: "shield",
              }),
              item({
                id: "partner.settings.security.events",
                label: "Eventos de segurança",
                href: "/admin/settings/security/events",
                iconKey: "activity",
              }),
              // Google and link on the partner's hosts (CF5b).
              item({
                id: "partner.settings.authentication",
                label: "Autenticação",
                href: "/admin/settings/authentication",
                iconKey: "key",
              }),
            ]
          : []),
        // The partner's own analytics identifier, optional (CF7).
        ...(grants("partner.read")
          ? [
              item({
                id: "partner.settings.analytics",
                label: "Analytics",
                href: "/admin/settings/analytics",
                iconKey: "activity",
              }),
            ]
          : []),
      ],
    },
  ];
  return sections.filter((section) => section.items.length > 0);
}
