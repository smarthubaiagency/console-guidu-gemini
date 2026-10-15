import { describe, expect, it } from "vitest";

import {
  effectivePublicBases,
  hostSuffixes,
  platformPublicBases,
  type PublicBase,
  type PublicHostLookup,
  type PublicWorkspace,
  resolvePublicHostWith,
  workspaceDefaultHost,
} from "./public-hosts";
import { checkBaseDomain } from "./verify";

const PLATFORM = {
  profile: "mobio.pro",
  quiz: "quiz.mobio.pro",
  page: "mobio.page",
} as const;
const PARTNER = "b0000000-0000-4000-8000-000000000001";
const OTHER = "b0000000-0000-4000-8000-000000000002";
const HOUSE = "00000000-0000-4000-8000-000000000000";

function workspace(
  slug: string,
  partnerId = HOUSE,
  replacedTypes: string[] = [],
): PublicWorkspace {
  return {
    workspaceId: `ws-${slug}`,
    organizationId: `org-${slug}`,
    workspaceSlug: slug,
    partnerId,
    replacedTypes,
  };
}

function lookup(
  over: Partial<{
    workspaces: PublicWorkspace[];
    partnerBases: PublicBase[];
    custom: Record<string, string>;
  }> = {},
): PublicHostLookup {
  const workspaces = over.workspaces ?? [workspace("rodobens")];
  return {
    platformBases: PLATFORM,
    dashboardHosts: new Set(["console.guidu.co", "localhost"]),
    async customDomain(host) {
      const slug = over.custom?.[host];
      return slug
        ? {
            workspaceId: `ws-${slug}`,
            organizationId: `org-${slug}`,
            workspaceSlug: slug,
            tools: [{ toolKey: "digital-profile", routeType: "profile" }],
          }
        : null;
    },
    async partnerBases(hosts) {
      return (over.partnerBases ?? []).filter((b) => hosts.includes(b.host));
    },
    async workspaceBySlug(slug) {
      return workspaces.find((w) => w.workspaceSlug === slug) ?? null;
    },
  };
}

describe("platformPublicBases", () => {
  it("uses the defaults, the variables and drops clashes", () => {
    expect(platformPublicBases({})).toEqual(PLATFORM);
    expect(
      platformPublicBases({
        PUBLIC_DOMAIN_PROFILE: "Cards.Example.com",
        PUBLIC_DOMAIN_QUIZ: "",
        PUBLIC_DOMAIN_PAGE: "semponto",
      }),
    ).toEqual({ profile: "cards.example.com", quiz: null, page: null });
    // A dashboard host or the partner subdomain base never serves pages.
    expect(
      platformPublicBases({
        APP_URL: "https://mobio.pro",
        PARTNER_SUBDOMAIN_BASE: "mobio.page",
        NODE_ENV: "production",
      }),
    ).toEqual({ profile: null, quiz: "quiz.mobio.pro", page: null });
  });
});

describe("workspaceDefaultHost", () => {
  const all = Object.values(PLATFORM);
  it("builds the subdomain of the slug", () => {
    expect(workspaceDefaultHost("rodobens", "mobio.pro", all)).toBe(
      "rodobens.mobio.pro",
    );
    expect(workspaceDefaultHost("rodobens", "quiz.mobio.pro", all)).toBe(
      "rodobens.quiz.mobio.pro",
    );
    expect(workspaceDefaultHost("rodobens", null, all)).toBeNull();
  });

  it("refuses reserved labels and labels that form another domain", () => {
    expect(workspaceDefaultHost("www", "mobio.pro", all)).toBeNull();
    expect(workspaceDefaultHost("api", "mobio.page", all)).toBeNull();
    expect(workspaceDefaultHost("quiz", "mobio.pro", all)).toBeNull();
    expect(workspaceDefaultHost("quiz", "mobio.page", all)).toBe(
      "quiz.mobio.page",
    );
    expect(workspaceDefaultHost("nao_dns", "mobio.pro", all)).toBeNull();
    expect(workspaceDefaultHost("-hifen", "mobio.pro", all)).toBeNull();
  });
});

describe("hostSuffixes", () => {
  it("lists the host and its parents with two labels or more", () => {
    expect(hostSuffixes("a.quiz.mobio.pro")).toEqual([
      "a.quiz.mobio.pro",
      "quiz.mobio.pro",
      "mobio.pro",
    ]);
  });
});

describe("resolvePublicHostWith", () => {
  it("resolves the default subdomain of each type, longest domain first", async () => {
    await expect(
      resolvePublicHostWith("Rodobens.Mobio.Pro:443", lookup()),
    ).resolves.toMatchObject({
      kind: "default",
      host: "rodobens.mobio.pro",
      routeType: "profile",
      partnerId: null,
      workspaceId: "ws-rodobens",
    });
    await expect(
      resolvePublicHostWith("rodobens.quiz.mobio.pro", lookup()),
    ).resolves.toMatchObject({ kind: "default", routeType: "quiz" });
    await expect(
      resolvePublicHostWith("rodobens.mobio.page", lookup()),
    ).resolves.toMatchObject({ kind: "default", routeType: "page" });
  });

  it("answers the root of each type without a workspace", async () => {
    await expect(
      resolvePublicHostWith("quiz.mobio.pro", lookup()),
    ).resolves.toEqual({
      kind: "base",
      host: "quiz.mobio.pro",
      routeType: "quiz",
      partnerId: null,
    });
    await expect(
      resolvePublicHostWith("mobio.pro", lookup()),
    ).resolves.toMatchObject({ kind: "base", routeType: "profile" });
  });

  it("refuses unknown, reserved and nested hosts", async () => {
    const ws = [workspace("rodobens"), workspace("www"), workspace("console")];
    for (const host of [
      "desconhecido.mobio.pro",
      "www.mobio.pro",
      "a.rodobens.mobio.pro",
      "rodobens.outro.com",
      "console.guidu.co",
      "localhost",
      "",
      "rodobens..mobio.pro",
    ]) {
      await expect(
        resolvePublicHostWith(host, lookup({ workspaces: ws })),
      ).resolves.toBeNull();
    }
  });

  it("serves own domains with the tools that chose them", async () => {
    await expect(
      resolvePublicHostWith(
        "cards.rodobens.com",
        lookup({ custom: { "cards.rodobens.com": "rodobens" } }),
      ),
    ).resolves.toMatchObject({
      kind: "custom",
      workspaceId: "ws-rodobens",
      tools: [{ toolKey: "digital-profile", routeType: "profile" }],
    });
  });

  it("applies the partner's default domain to its customers only", async () => {
    const partnerBases: PublicBase[] = [
      { host: "cartao.agencia.com", routeType: "profile", partnerId: PARTNER },
    ];
    const ws = [
      workspace("rodobens", PARTNER, ["profile"]),
      workspace("vizinho", OTHER),
      workspace("casa"),
    ];
    const l = lookup({ workspaces: ws, partnerBases });

    await expect(
      resolvePublicHostWith("rodobens.cartao.agencia.com", l),
    ).resolves.toMatchObject({
      kind: "default",
      routeType: "profile",
      partnerId: PARTNER,
      workspaceId: "ws-rodobens",
    });
    // Another partner's customer and the house's are not served there.
    await expect(
      resolvePublicHostWith("vizinho.cartao.agencia.com", l),
    ).resolves.toBeNull();
    await expect(
      resolvePublicHostWith("casa.cartao.agencia.com", l),
    ).resolves.toBeNull();
    // The replaced platform domain no longer serves the partner's customer…
    await expect(
      resolvePublicHostWith("rodobens.mobio.pro", l),
    ).resolves.toBeNull();
    // …but other types and other customers keep the platform's.
    await expect(
      resolvePublicHostWith("rodobens.quiz.mobio.pro", l),
    ).resolves.toMatchObject({ kind: "default", routeType: "quiz" });
    await expect(
      resolvePublicHostWith("vizinho.mobio.pro", l),
    ).resolves.toMatchObject({ kind: "default", workspaceId: "ws-vizinho" });
    await expect(
      resolvePublicHostWith("cartao.agencia.com", l),
    ).resolves.toMatchObject({ kind: "base", partnerId: PARTNER });
  });
});

describe("effectivePublicBases", () => {
  it("prefers the partner's domain of a type", () => {
    expect(
      effectivePublicBases(PLATFORM, [
        { routeType: "quiz", host: "quiz.agencia.com" },
      ]),
    ).toEqual({
      profile: { host: "mobio.pro", source: "platform" },
      quiz: { host: "quiz.agencia.com", source: "partner" },
      page: { host: "mobio.page", source: "platform" },
    });
  });
});

describe("checkBaseDomain", () => {
  const TARGET = "proxy.guidu.test";
  const deps = (map: Record<string, string[]>) => ({
    cnameTarget: TARGET,
    probeLabel: "guidu-check-abc",
    resolveCname: async (name: string) => {
      const value = map[name];
      if (!value) throw new Error("ENOTFOUND");
      return value;
    },
  });

  it("needs the target, the domain and the wildcard", async () => {
    await expect(
      checkBaseDomain("cartao.agencia.test", {
        ...deps({}),
        cnameTarget: null,
      }),
    ).resolves.toEqual({ status: "pending", lastError: "not_configured" });
    await expect(
      checkBaseDomain("cartao.agencia.test", deps({})),
    ).resolves.toEqual({ status: "pending", lastError: "dns_pending" });
    await expect(
      checkBaseDomain(
        "cartao.agencia.test",
        deps({ "cartao.agencia.test": [`${TARGET}.`] }),
      ),
    ).resolves.toEqual({ status: "pending", lastError: "wildcard_pending" });
    await expect(
      checkBaseDomain(
        "cartao.agencia.test",
        deps({
          "cartao.agencia.test": [TARGET],
          "guidu-check-abc.cartao.agencia.test": [TARGET],
        }),
      ),
    ).resolves.toEqual({ status: "active", lastError: null });
  });
});
