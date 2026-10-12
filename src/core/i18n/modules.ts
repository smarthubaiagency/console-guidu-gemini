import "server-only";

import { getTranslations } from "next-intl/server";

import { listRegisteredModules } from "@/modules/registry";

/**
 * Texts of the module manifests in the request language (I4). Manifests
 * keep the Portuguese text, which is also the fallback when a message is
 * missing. Keys live in the `moduleCatalog` namespace:
 * `<moduleKey>.name`, `.description`, `.nav.<entryId>`,
 * `.settings.<entryId>`, `.permissions.<key>` and `.quotas.<key>`, with
 * `-` and `.` written as `_`.
 */

type Translator = {
  (key: string): string;
  has(key: string): boolean;
};

const keyOf = (value: string) => value.replace(/[.-]/g, "_");

export type ModuleCatalog = Readonly<{
  name(moduleKey: string, fallback: string): string;
  description(moduleKey: string, fallback: string): string;
  navLabel(moduleKey: string, entryId: string, fallback: string): string;
  settingsLabel(moduleKey: string, entryId: string, fallback: string): string;
  permission(
    moduleKey: string,
    permissionKey: string,
    fallback: string,
  ): string;
  quota(moduleKey: string, quotaKey: string, fallback: string): string;
  /**
   * Label of a navigation or settings entry found by id in any registered
   * module, or null when no module declares it (core entries).
   */
  entryLabel(entryId: string): string | null;
  /**
   * Quota found by key in any registered module, as its description alone
   * and as the "Module: description" label of the usage page, or null when
   * no module declares it (core quotas).
   */
  findQuota(
    quotaKey: string,
  ): Readonly<{ description: string; label: string }> | null;
}>;

/** Builds the catalog over a translator of the `moduleCatalog` namespace. */
export function moduleCatalog(t: Translator): ModuleCatalog {
  const text = (key: string, fallback: string) =>
    t.has(key) ? t(key) : fallback;
  const nav = (moduleKey: string, entryId: string, fallback: string) =>
    text(`${keyOf(moduleKey)}.nav.${keyOf(entryId)}`, fallback);
  const settings = (moduleKey: string, entryId: string, fallback: string) =>
    text(`${keyOf(moduleKey)}.settings.${keyOf(entryId)}`, fallback);
  const name = (moduleKey: string, fallback: string) =>
    text(`${keyOf(moduleKey)}.name`, fallback);
  const quota = (moduleKey: string, quotaKey: string, fallback: string) =>
    text(`${keyOf(moduleKey)}.quotas.${keyOf(quotaKey)}`, fallback);

  return {
    name,
    description: (moduleKey, fallback) =>
      text(`${keyOf(moduleKey)}.description`, fallback),
    navLabel: nav,
    settingsLabel: settings,
    permission: (moduleKey, permissionKey, fallback) =>
      text(`${keyOf(moduleKey)}.permissions.${keyOf(permissionKey)}`, fallback),
    quota,
    entryLabel: (entryId) => {
      for (const { manifest } of listRegisteredModules()) {
        const key = manifest.moduleKey;
        for (const entry of manifest.navigation) {
          if (entry.id === entryId) return nav(key, entry.id, entry.label);
          const child = entry.children.find((c) => c.id === entryId);
          if (child) return nav(key, child.id, child.label);
        }
        const setting = manifest.settings.find((s) => s.id === entryId);
        if (setting) return settings(key, setting.id, setting.label);
      }
      return null;
    },
    findQuota: (quotaKey) => {
      for (const { manifest } of listRegisteredModules()) {
        const entitlement = manifest.entitlements.find(
          (e) => e.key === quotaKey && e.kind === "quota",
        );
        if (!entitlement) continue;
        const description = quota(
          manifest.moduleKey,
          entitlement.key,
          entitlement.description,
        );
        return {
          description,
          label: `${name(manifest.moduleKey, manifest.displayName)}: ${description}`,
        };
      }
      return null;
    },
  };
}

/** The catalog in the request language. */
export async function getModuleCatalog(): Promise<ModuleCatalog> {
  return moduleCatalog(await getTranslations("moduleCatalog"));
}
