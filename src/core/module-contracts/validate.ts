/**
 * ============================================================================
 * File: src/core/module-contracts/validate.ts
 * Module: Module Registry Validation (Adendo §5, §8.1 e §8.2)
 *
 * Maintenance Rationale:
 * - Parses every manifest with Zod and checks what one manifest cannot check
 *   alone: duplicated keys, conflicting routes, navigation and settings ids,
 *   undeclared permissions, unknown routes, missing dependencies, cycles and
 *   contract/platform compatibility.
 * - Runs when the registry module is first imported, so a broken manifest
 *   fails tests and `next build` instead of a user request.
 * ============================================================================
 */

import {
  MODULE_CONTRACT_VERSION,
  ModuleManifestSchema,
  PLATFORM_VERSION,
  type ModuleManifest,
  type ModuleManifestInput,
} from "./manifest";

export class ModuleRegistryError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Registro de módulos inválido:\n- ${problems.join("\n- ")}`);
    this.name = "ModuleRegistryError";
    this.problems = problems;
  }
}

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Permission namespace of a module: `hello-world` → `hello_world`. */
export function permissionNamespace(moduleKey: string): string {
  return moduleKey.replaceAll("-", "_");
}

export type ValidateRegistryOptions = Readonly<{
  /** Permissions owned by the core catalog, which any module may require. */
  corePermissions: ReadonlySet<string>;
}>;

/**
 * Validates the full set of registered manifests.
 *
 * @throws {ModuleRegistryError} listing every problem found.
 */
export function validateModuleRegistry(
  inputs: readonly ModuleManifestInput[],
  options: ValidateRegistryOptions,
): readonly ModuleManifest[] {
  const problems: string[] = [];
  const manifests: ModuleManifest[] = [];

  inputs.forEach((input, index) => {
    const parsed = ModuleManifestSchema.safeParse(input);
    if (!parsed.success) {
      const key =
        typeof input === "object" && input && "moduleKey" in input
          ? String(input.moduleKey)
          : `#${index}`;
      for (const issue of parsed.error.issues) {
        problems.push(
          `${key}: ${issue.path.join(".") || "manifesto"} — ${issue.message}`,
        );
      }
      return;
    }
    manifests.push(parsed.data);
  });

  const contractMajor = MODULE_CONTRACT_VERSION.split(".")[0];
  const moduleKeys = new Set<string>();
  const routePaths = new Map<string, string>();
  const navigationIds = new Set<string>();
  const settingsIds = new Set<string>();
  const componentKeys = new Set<string>();
  const modulePermissions = new Map<string, string>();

  for (const manifest of manifests) {
    const key = manifest.moduleKey;

    if (moduleKeys.has(key)) problems.push(`${key}: moduleKey duplicado.`);
    moduleKeys.add(key);

    if (manifest.contractVersion.split(".")[0] !== contractMajor) {
      problems.push(
        `${key}: contractVersion ${manifest.contractVersion} incompatível com ${MODULE_CONTRACT_VERSION}.`,
      );
    }
    if (
      compareSemver(
        manifest.platformCompatibility.minPlatformVersion,
        PLATFORM_VERSION,
      ) > 0
    ) {
      problems.push(
        `${key}: exige plataforma ${manifest.platformCompatibility.minPlatformVersion}, atual ${PLATFORM_VERSION}.`,
      );
    }

    // Permissions: namespaced by module and never redefining core ones.
    const namespace = `${permissionNamespace(key)}.`;
    for (const permission of manifest.permissions) {
      if (!permission.key.startsWith(namespace)) {
        problems.push(
          `${key}: permissão ${permission.key} fora do namespace ${namespace}*.`,
        );
      }
      if (options.corePermissions.has(permission.key)) {
        problems.push(
          `${key}: permissão ${permission.key} já pertence ao núcleo.`,
        );
      }
      if (modulePermissions.has(permission.key)) {
        problems.push(`${key}: permissão ${permission.key} duplicada.`);
      }
      modulePermissions.set(permission.key, key);
    }

    // Routes: unique keys and paths inside the module namespace.
    const routes = new Map<string, (typeof manifest.routes)[number]>();
    for (const route of manifest.routes) {
      if (routes.has(route.routeKey)) {
        problems.push(`${key}: routeKey ${route.routeKey} duplicado.`);
      }
      routes.set(route.routeKey, route);
      if (route.path.split("/")[0] !== key) {
        problems.push(`${key}: rota ${route.path} deve começar por ${key}/.`);
      }
      const fullPath = `${route.destination}:${route.path}`;
      const owner = routePaths.get(fullPath);
      if (owner)
        problems.push(`${key}: rota ${route.path} conflita com ${owner}.`);
      routePaths.set(fullPath, key);
    }

    // Navigation: unique ids, known routes on the same destination.
    for (const entry of manifest.navigation) {
      for (const item of [entry, ...entry.children]) {
        if (navigationIds.has(item.id))
          problems.push(`${key}: navegação ${item.id} duplicada.`);
        navigationIds.add(item.id);
        if (item.routeKey) {
          const route = routes.get(item.routeKey);
          if (!route) {
            problems.push(
              `${key}: navegação ${item.id} aponta para rota inexistente ${item.routeKey}.`,
            );
          } else if (route.destination !== entry.destination) {
            problems.push(
              `${key}: navegação ${item.id} aponta para rota de outro destino.`,
            );
          } else if (route.path.includes("[")) {
            problems.push(
              `${key}: navegação ${item.id} não pode apontar para rota com parâmetro.`,
            );
          }
        }
      }
      if (!entry.routeKey && entry.children.length === 0) {
        problems.push(
          `${key}: navegação ${entry.id} sem rota precisa de filhos.`,
        );
      }
    }

    // Settings: one entry per destination, unique ids and component keys.
    const destinations = new Set<string>();
    for (const entry of manifest.settings) {
      if (destinations.has(entry.destination)) {
        problems.push(
          `${key}: mais de uma entrada de settings para ${entry.destination}.`,
        );
      }
      destinations.add(entry.destination);
      if (settingsIds.has(entry.id))
        problems.push(`${key}: settings ${entry.id} duplicado.`);
      settingsIds.add(entry.id);
      if (componentKeys.has(entry.componentKey)) {
        problems.push(`${key}: componentKey ${entry.componentKey} duplicado.`);
      }
      componentKeys.add(entry.componentKey);
      const schema =
        entry.destination === "workspace"
          ? manifest.configurationSchema.workspace
          : manifest.configurationSchema.admin;
      if (!schema) {
        problems.push(
          `${key}: settings ${entry.id} exige configurationSchema.${entry.destination}.`,
        );
      }
    }
  }

  // Cross-module checks: permission references and dependencies.
  for (const manifest of manifests) {
    const key = manifest.moduleKey;
    const referenced = [
      ...manifest.navigation.flatMap((entry) => [
        ...entry.requiredPermissions,
        ...entry.children.flatMap((child) => child.requiredPermissions),
      ]),
      ...manifest.settings.flatMap((entry) => [
        ...entry.readPermissions,
        ...entry.writePermissions,
      ]),
    ];
    for (const permission of referenced) {
      const owner = modulePermissions.get(permission);
      const known = options.corePermissions.has(permission) || owner === key;
      if (!known) {
        problems.push(
          `${key}: permissão ${permission} não declarada pelo módulo nem pelo núcleo.`,
        );
      }
    }

    for (const dependency of [
      ...manifest.dependencies.required,
      ...manifest.dependencies.optional,
    ]) {
      if (dependency === key) problems.push(`${key}: depende de si mesmo.`);
    }
    for (const dependency of manifest.dependencies.required) {
      if (!moduleKeys.has(dependency)) {
        problems.push(
          `${key}: dependência obrigatória ${dependency} não registrada.`,
        );
      }
    }
  }

  // Required dependency cycles.
  const graph = new Map(
    manifests.map((m) => [m.moduleKey, m.dependencies.required]),
  );
  const state = new Map<string, "visiting" | "done">();
  const visit = (node: string, trail: string[]): void => {
    if (state.get(node) === "done") return;
    if (state.get(node) === "visiting") {
      problems.push(`Ciclo de dependências: ${[...trail, node].join(" → ")}.`);
      return;
    }
    state.set(node, "visiting");
    for (const next of graph.get(node) ?? []) {
      if (graph.has(next)) visit(next, [...trail, node]);
    }
    state.set(node, "done");
  };
  for (const node of graph.keys()) visit(node, []);

  if (problems.length > 0) throw new ModuleRegistryError(problems);
  return Object.freeze(manifests);
}
