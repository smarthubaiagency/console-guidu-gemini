import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { ModuleManifestInput } from "./manifest";
import { ModuleRegistryError, validateModuleRegistry } from "./validate";

const corePermissions = new Set(["workspace.read", "platform.modules.read"]);

function manifest(
  overrides: Partial<ModuleManifestInput> = {},
): ModuleManifestInput {
  return {
    moduleKey: "sample",
    displayName: "Sample",
    description: "Sample module",
    moduleVersion: "1.0.0",
    contractVersion: "1.0.0",
    platformCompatibility: { minPlatformVersion: "0.1.0" },
    releaseStatus: "beta",
    routes: [{ routeKey: "sample.home", destination: "app", path: "sample" }],
    navigation: [
      {
        id: "sample",
        destination: "app",
        groupKey: "modules",
        label: "Sample",
        routeKey: "sample.home",
        order: 0,
        requiredPermissions: ["sample.read"],
      },
    ],
    permissions: [
      {
        key: "sample.read",
        description: "Read",
        defaultWorkspaceRoles: ["owner"],
      },
    ],
    ...overrides,
  };
}

function problemsOf(inputs: ModuleManifestInput[]): readonly string[] {
  try {
    validateModuleRegistry(inputs, { corePermissions });
    return [];
  } catch (error) {
    if (error instanceof ModuleRegistryError) return error.problems;
    throw error;
  }
}

describe("validateModuleRegistry", () => {
  it("accepts a valid manifest and applies defaults", () => {
    const [parsed] = validateModuleRegistry([manifest()], { corePermissions });
    expect(parsed?.settings).toEqual([]);
    expect(parsed?.navigation[0]?.children).toEqual([]);
  });

  it("rejects malformed module keys through Zod", () => {
    expect(problemsOf([manifest({ moduleKey: "Bad_Key" })]).join()).toMatch(
      /moduleKey/,
    );
  });

  it("rejects duplicated module keys", () => {
    expect(problemsOf([manifest(), manifest()]).join()).toMatch(
      /moduleKey duplicado/,
    );
  });

  it("rejects routes outside the module namespace and conflicting routes", () => {
    const outside = manifest({
      routes: [
        { routeKey: "sample.home", destination: "app", path: "settings" },
      ],
    });
    expect(problemsOf([outside]).join()).toMatch(/deve começar por sample/);
  });

  it("rejects navigation pointing to unknown or parameterized routes", () => {
    const unknown = manifest({
      navigation: [
        {
          id: "sample",
          destination: "app",
          groupKey: "modules",
          label: "Sample",
          routeKey: "sample.missing",
          order: 0,
        },
      ],
    });
    expect(problemsOf([unknown]).join()).toMatch(/rota inexistente/);

    const parameterized = manifest({
      routes: [
        { routeKey: "sample.item", destination: "app", path: "sample/[id]" },
      ],
      navigation: [
        {
          id: "sample",
          destination: "app",
          groupKey: "modules",
          label: "Sample",
          routeKey: "sample.item",
          order: 0,
        },
      ],
    });
    expect(problemsOf([parameterized]).join()).toMatch(/parâmetro/);
  });

  it("rejects a grouping entry without children", () => {
    const group = manifest({
      navigation: [
        {
          id: "sample",
          destination: "app",
          groupKey: "modules",
          label: "Sample",
          order: 0,
        },
      ],
    });
    expect(problemsOf([group]).join()).toMatch(/sem rota precisa de filhos/);
  });

  it("rejects permissions outside the namespace, redefining core or undeclared", () => {
    const wrongNamespace = manifest({
      permissions: [
        { key: "other.read", description: "x", defaultWorkspaceRoles: [] },
      ],
    });
    const problems = problemsOf([wrongNamespace]).join();
    expect(problems).toMatch(/fora do namespace/);
    expect(problems).toMatch(/sample\.read não declarada/);

    const core = manifest({
      moduleKey: "workspace",
      routes: [],
      navigation: [],
      permissions: [
        { key: "workspace.read", description: "x", defaultWorkspaceRoles: [] },
      ],
    });
    expect(problemsOf([core]).join()).toMatch(/já pertence ao núcleo/);
  });

  it("requires a configuration schema for each settings destination", () => {
    const settings = manifest({
      settings: [
        {
          id: "sample.workspace",
          destination: "workspace",
          label: "Sample",
          order: 0,
          componentKey: "sample.settings",
        },
      ],
    });
    expect(problemsOf([settings]).join()).toMatch(
      /configurationSchema\.workspace/,
    );

    const withSchema = manifest({
      settings: settings.settings ?? [],
      configurationSchema: { workspace: z.object({}) },
    });
    expect(problemsOf([withSchema])).toEqual([]);
  });

  it("rejects missing dependencies, self dependencies and cycles", () => {
    const a = manifest({
      moduleKey: "a",
      routes: [],
      navigation: [],
      permissions: [],
      dependencies: { required: ["b"], optional: [] },
    });
    const b = manifest({
      moduleKey: "b",
      routes: [],
      navigation: [],
      permissions: [],
      dependencies: { required: ["a"], optional: [] },
    });
    expect(problemsOf([a, b]).join()).toMatch(/Ciclo de dependências/);
    expect(problemsOf([a]).join()).toMatch(/dependência obrigatória b/);
  });

  it("rejects incompatible contract or platform versions", () => {
    const problems = problemsOf([
      manifest({
        contractVersion: "2.0.0",
        platformCompatibility: { minPlatformVersion: "9.0.0" },
      }),
    ]).join();
    expect(problems).toMatch(/contractVersion/);
    expect(problems).toMatch(/exige plataforma/);
  });
});
