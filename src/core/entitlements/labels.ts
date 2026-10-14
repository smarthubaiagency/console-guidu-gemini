import "server-only";

import { getTranslations } from "next-intl/server";

import { getModuleCatalog } from "@/core/i18n/modules";

import { findQuotaEntry, type QuotaEntry, quotaMessageId } from "./catalog";

/**
 * Texts of the quota catalog (CF4) in the request language: the plans
 * pages and the usage page read labels and units from here, so a quota is
 * named the same everywhere. Core keys live in `plans.quotas.<id>`; module
 * keys in the module catalog (I4), as "Module: description".
 */
export type QuotaTexts = Readonly<{
  label(entry: QuotaEntry): string;
  description(entry: QuotaEntry): string;
  /** Label by key; the key itself when no entry declares it. */
  labelOf(key: string, fallback?: string): string;
  /** A value in the unit of the quota; null is "sem limite". */
  value(entry: QuotaEntry, value: number | null): string;
  scope(entry: QuotaEntry): string;
}>;

export async function getQuotaTexts(): Promise<QuotaTexts> {
  const t = await getTranslations("plans");
  const catalog = await getModuleCatalog();
  const text = (key: string, fallback: string) =>
    t.has(key) ? t(key) : fallback;

  const label = (entry: QuotaEntry) =>
    entry.owner === "core"
      ? text(`quotas.${quotaMessageId(entry.key)}.label`, entry.label)
      : (catalog.findQuota(entry.key)?.label ?? entry.label);
  const description = (entry: QuotaEntry) =>
    entry.owner === "core"
      ? text(
          `quotas.${quotaMessageId(entry.key)}.description`,
          entry.description,
        )
      : (catalog.findQuota(entry.key)?.description ?? entry.description);

  return {
    label,
    description,
    labelOf: (key, fallback) => {
      const entry = findQuotaEntry(key);
      return entry ? label(entry) : (fallback ?? key);
    },
    value: (entry, value) =>
      value === null
        ? t("values.unlimited")
        : t(`units.${entry.unit}`, { value }),
    scope: (entry) => t(`scope.${entry.scope}`),
  };
}
