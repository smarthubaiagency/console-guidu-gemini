import type { CompanyContract } from "@/core/entitlements/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { activeNavItemId } from "@/components/layout/nav-active";
import { workspaceRoleGrants } from "@/core/permissions/guard";
import type { WorkspaceRole } from "@/core/permissions/roles";
import { listRegisteredModules } from "@/modules/registry";
import { listSettingsComponentKeys } from "@/modules/settings-components";

import {
  buildPartnerNavigation,
  buildPlatformNavigation,
  buildAppNavigation,
  type NavItem,
  type NavSection,
} from "./navigation";
import { partnerGrants, platformGrants } from "./loaders";
import type { PlatformModuleState, WorkspaceModuleState } from "./state";

const enabled: WorkspaceModuleState = { status: "enabled", config: {} };

function grantsFor(role: WorkspaceRole | null) {
  return (permission: string) =>
    role !== null && workspaceRoleGrants(role, permission as never);
}

function app(
  role: WorkspaceRole | null,
  workspaceStates: Record<string, WorkspaceModuleState> = {},
  platformStates: Record<string, PlatformModuleState> = {},
  contract?: CompanyContract,
): NavSection[] {
  return buildAppNavigation({
    workspaceSlug: "acme",
    modules: listRegisteredModules(),
    platformStates: new Map(Object.entries(platformStates)),
    workspaceStates: new Map(Object.entries(workspaceStates)),
    grants: grantsFor(role),
    ...(contract ? { contract } : {}),
  });
}

function find(sections: NavSection[], id: string): NavItem | undefined {
  for (const section of sections) {
    for (const item of section.items) {
      if (item.id === id) return item;
      const child = item.children.find((c) => c.id === id);
      if (child) return child;
    }
  }
  return undefined;
}

describe("generated navigation", () => {
  beforeEach(() => {
    vi.stubEnv("GUIDU_MODULE_HELLO_WORLD_ENABLED", "true");
    vi.stubEnv("GUIDU_MODULE_AI_AGENTS_ENABLED", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("shows the module only in the workspace that enabled it", () => {
    expect(find(app("owner"), "hello-world")).toBeUndefined();
    const item = find(app("owner", { "hello-world": enabled }), "hello-world");
    expect(item?.href).toBeNull();
    expect(item?.badge).toBe("Beta");
    expect(item?.children.map((c) => c.href)).toEqual([
      "/app/acme/hello-world",
      "/app/acme/hello-world/records",
    ]);
  });

  it("removes entries the role cannot read and keeps core entries", () => {
    const sections = app(null, { "hello-world": enabled });
    expect(find(sections, "hello-world")).toBeUndefined();
    expect(find(sections, "core.overview")?.href).toBe("/app/acme");
  });

  it("keeps coming-soon modules as placeholders and hides gated ones", () => {
    const sections = app("viewer");
    expect(find(sections, "catalog")?.badge).toBe("Em breve");
    expect(find(sections, "ai-agents")).toBeUndefined();
    vi.stubEnv("GUIDU_MODULE_HELLO_WORLD_ENABLED", "false");
    expect(
      find(app("owner", { "hello-world": enabled }), "hello-world"),
    ).toBeUndefined();
  });

  it("shows maintenance without children and hides globally disabled modules", () => {
    const maintenance = find(
      app(
        "owner",
        { "hello-world": enabled },
        { "hello-world": { availability: "maintenance", config: {} } },
      ),
      "hello-world",
    );
    expect(maintenance?.badge).toBe("Manutenção");
    expect(maintenance?.children).toEqual([]);
    expect(maintenance?.href).toBe("/app/acme/hello-world");

    const disabled = app(
      "owner",
      { "hello-world": enabled },
      {
        "hello-world": { availability: "disabled", config: {} },
      },
    );
    expect(find(disabled, "hello-world")).toBeUndefined();
  });

  it("hides modules outside the plan and keeps suspended ones readable (F3b)", () => {
    const contract = (
      status: "active" | "suspended",
      moduleKeys: string[],
    ): CompanyContract => ({
      kind: "subscribed",
      status,
      planName: "Plano",
      planVersion: 2,
      moduleKeys,
      limits: {},
      provisional: false,
    });
    const states = { "hello-world": enabled };
    expect(
      find(
        app("owner", states, {}, contract("active", ["catalog"])),
        "hello-world",
      ),
    ).toBeUndefined();
    const suspended = find(
      app("owner", states, {}, contract("suspended", ["hello-world"])),
      "hello-world",
    );
    expect(suspended?.badge).toBe("Só leitura");
    expect(suspended?.children.length).toBeGreaterThan(0);
  });

  it("shows plan and billing to workspace owners and admins only (P5m)", () => {
    expect(find(app("owner"), "core.billing")?.href).toBe(
      "/app/acme/settings/billing",
    );
    expect(find(app("admin"), "core.billing")).toBeDefined();
    expect(find(app("viewer"), "core.billing")).toBeUndefined();
    // Data and privacy (F3e): owner and admin only.
    expect(find(app("owner"), "core.data")?.href).toContain("/settings/data");
    expect(find(app("admin"), "core.data")).toBeDefined();
    expect(find(app("editor"), "core.data")).toBeUndefined();
  });

  it("adds workspace settings under Módulos only for enabled modules", () => {
    expect(find(app("owner"), "core.modules")?.children).toEqual([]);
    const modules = find(
      app("viewer", { "hello-world": enabled }),
      "core.modules",
    );
    expect(modules?.children.map((c) => c.href)).toEqual([
      "/app/acme/settings/modules/hello-world",
    ]);
  });

  it("orders module entries deterministically", () => {
    const ids = app("owner", { "hello-world": enabled })[0]?.items.map(
      (i) => i.id,
    );
    expect(ids).toEqual([
      "core.overview",
      "catalog",
      "google-business",
      "hello-world",
      "core.executions",
    ]);
  });

  it("builds admin settings by internal role", () => {
    const owner = buildPlatformNavigation({
      modules: listRegisteredModules(),
      grants: platformGrants("owner"),
    });
    expect(find(owner, "platform.modules")?.href).toBe("/platform/modules");
    expect(find(owner, "hello-world.admin")?.href).toBe(
      "/platform/settings/modules/hello-world",
    );

    const none = buildPlatformNavigation({
      modules: listRegisteredModules(),
      grants: platformGrants(null),
    });
    expect(find(none, "platform.modules")).toBeUndefined();
    expect(find(owner, "platform.brand")?.href).toBe("/platform/brand");
    expect(find(none, "platform.brand")).toBeUndefined();
    expect(find(owner, "platform.billing")?.href).toBe("/platform/billing");
    expect(find(none, "platform.billing")).toBeUndefined();
    expect(find(none, "hello-world.admin")).toBeUndefined();
    // Operations (F3d): owner, operations and support; not billing.
    expect(find(owner, "platform.operations")?.href).toBe(
      "/platform/operations",
    );
    const support = buildPlatformNavigation({
      modules: listRegisteredModules(),
      grants: platformGrants("support"),
    });
    expect(find(support, "platform.operations")).toBeDefined();
    const billing = buildPlatformNavigation({
      modules: listRegisteredModules(),
      grants: platformGrants("billing"),
    });
    expect(find(billing, "platform.operations")).toBeUndefined();
  });

  it("builds the partner console by partner role (D-PA-02)", () => {
    const owner = buildPartnerNavigation(partnerGrants("partner_owner"));
    expect(owner.flatMap((s) => s.items).map((i) => i.href)).toEqual([
      "/admin",
      "/admin/customers",
      "/admin/modules",
      "/admin/templates",
      "/admin/billing",
      "/admin/support",
      "/admin/legal",
      "/admin/members",
      "/admin/brand",
    ]);

    const finance = buildPartnerNavigation(partnerGrants("partner_finance"));
    expect(find(finance, "partner.brand")).toBeUndefined();
    expect(find(finance, "partner.templates")).toBeUndefined();
    expect(find(finance, "partner.support")).toBeUndefined();
    const support = buildPartnerNavigation(partnerGrants("partner_support"));
    expect(find(support, "partner.support")?.href).toBe("/admin/support");
    expect(find(support, "partner.legal")).toBeUndefined();
    expect(find(finance, "partner.customers")?.href).toBe("/admin/customers");
    // P5m: money is for owner, admin and finance; never partner_support.
    expect(find(finance, "partner.billing")?.href).toBe("/admin/billing");
    expect(find(support, "partner.billing")).toBeUndefined();

    expect(
      buildPartnerNavigation(partnerGrants(null))
        .flatMap((s) => s.items)
        .map((i) => i.id),
    ).toEqual(["partner.overview"]);
  });

  it("marks the most specific route as active", () => {
    const sections = app("owner", { "hello-world": enabled });
    expect(activeNavItemId(sections, "/app/acme/hello-world/records/123")).toBe(
      "hello-world.records",
    );
    expect(activeNavItemId(sections, "/app/acme/hello-world")).toBe(
      "hello-world.home",
    );
    expect(activeNavItemId(sections, "/app/acme")).toBe("core.overview");
    expect(
      activeNavItemId(sections, "/app/acme/settings/modules/hello-world"),
    ).toBe("hello-world.workspace");
  });

  it("has a registered component for every settings componentKey", () => {
    const keys = new Set(listSettingsComponentKeys());
    for (const { manifest } of listRegisteredModules()) {
      for (const entry of manifest.settings) {
        expect(keys.has(entry.componentKey), entry.componentKey).toBe(true);
      }
    }
  });
});
