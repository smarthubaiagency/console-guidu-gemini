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
import type { PermissionKey } from "@/core/permissions/catalog";
import type { RegisteredModule } from "@/modules/registry";

import {
  moduleStateLabel,
  resolveModuleAccessState,
  type PlatformModuleState,
  type WorkspaceModuleState,
} from "./state";

export type NavIconKey =
  | ModuleIconKey
  | "code"
  | "gauge"
  | "key"
  | "layers"
  | "play-circle"
  | "building"
  | "handshake"
  | "palette"
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
  return { badge: null, exact: false, children: [], ...partial };
}

export type AppNavigationInput = Readonly<{
  workspaceSlug: string;
  modules: readonly RegisteredModule[];
  platformStates: ReadonlyMap<string, PlatformModuleState>;
  workspaceStates: ReadonlyMap<string, WorkspaceModuleState>;
  grants: Grants;
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
    );
    if (state === "hidden" || state === "not_enabled") continue;

    for (const entry of mod.manifest.navigation) {
      if (entry.destination !== "app") continue;
      if (!allGranted(entry.requiredPermissions, input.grants)) continue;

      const parentPath = routePath(mod, entry.routeKey);
      const operational = state === "enabled";
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
    );
    if (state !== "enabled" && state !== "maintenance") continue;

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
          badge: "Sem dados",
        }),
      ],
    },
    {
      id: "settings",
      label: "Configurações",
      items: [
        item({
          id: "core.team",
          label: "Equipe & Membros",
          href: `${base}/settings/team`,
          iconKey: "users",
        }),
        item({
          id: "core.general",
          label: "Geral",
          href: `${base}/settings/general`,
          iconKey: "settings",
        }),
        item({
          id: "core.modules",
          label: "Módulos",
          href: `${base}/settings/modules`,
          iconKey: "puzzle",
          exact: true,
          children: buildAppModuleSettingsItems(input),
        }),
        item({
          id: "core.credentials",
          label: "Credenciais BYOK",
          href: `${base}/settings/credentials`,
          iconKey: "key",
        }),
        item({
          id: "core.mcp",
          label: "Assistentes MCP",
          href: `${base}/settings/mcp`,
          iconKey: "bot",
        }),
        item({
          id: "core.api",
          label: "API e Webhooks",
          href: `${base}/settings/api`,
          iconKey: "code",
        }),
        item({
          id: "core.usage",
          label: "Consumo & Limites",
          href: `${base}/settings/usage`,
          iconKey: "gauge",
        }),
        // Temporary partner support access (ADR 0012, P4b2): owner/admin.
        ...(input.grants("workspace.members.manage")
          ? [
              item({
                id: "core.support",
                label: "Acesso de suporte",
                href: `${base}/settings/support`,
                iconKey: "hand",
              }),
            ]
          : []),
      ],
    },
  ];
}

export type PlatformNavigationInput = Readonly<{
  modules: readonly RegisteredModule[];
  grants: Grants;
}>;

/** Platform console sidebar (/platform): core entries plus global module settings. */
export function buildPlatformNavigation(
  input: PlatformNavigationInput,
): NavSection[] {
  const settingsItems = input.modules
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

  const canReadModules = input.grants("platform.modules.read");
  const canManageBrand = input.grants("platform.brand.manage");
  const canReadPartners = input.grants("platform.partners.read");
  const canManageLegal = input.grants("platform.legal.manage");

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
        ...(canManageBrand
          ? [
              item({
                id: "platform.brand",
                label: "Marca",
                href: "/platform/brand",
                iconKey: "palette",
              }),
            ]
          : []),
      ],
    },
    ...(settingsItems.length > 0
      ? [
          {
            id: "platform.settings",
            label: "Configurações de módulos",
            items: settingsItems,
          },
        ]
      : []),
  ];
}

/** Partner console sidebar (/admin, ADR 0012): driven by partner grants. */
export function buildPartnerNavigation(grants: Grants): NavSection[] {
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
        ...(grants("partner.brand.manage")
          ? [
              item({
                id: "partner.brand",
                label: "Marca",
                href: "/admin/brand",
                iconKey: "palette",
              }),
            ]
          : []),
      ],
    },
  ];
}
