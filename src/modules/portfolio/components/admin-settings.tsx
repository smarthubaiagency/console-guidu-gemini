import { getTranslations } from "next-intl/server";

import { ActionForm } from "@/components/partners/action-form";
import type { ModuleSettingsComponentProps } from "@/core/module-contracts/settings";

import {
  PORTFOLIO_DEFAULT_ITEM_LIMIT,
  PORTFOLIO_DEFAULT_VARIANT_LIMIT,
  PortfolioQuotas,
} from "../manifest";
import { savePortfolioAdminSettingsAction } from "../server/actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Admin settings of the Portfolio (portfolio.admin-settings): default
 * quotas for companies whose plan does not set them. A plan limit, set in
 * Plataforma › Cobrança, always wins.
 */
export async function PortfolioAdminSettings(
  props: ModuleSettingsComponentProps,
) {
  const t = await getTranslations("portfolio");
  const defaults =
    (props.config.quotaDefaults as Record<string, number> | undefined) ?? {};
  const fields = [
    {
      key: PortfolioQuotas.ITEMS,
      label: t("admin.items"),
      fallback: PORTFOLIO_DEFAULT_ITEM_LIMIT,
    },
    {
      key: PortfolioQuotas.VARIANTS,
      label: t("admin.variants"),
      fallback: PORTFOLIO_DEFAULT_VARIANT_LIMIT,
    },
  ];
  const inputs = (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((f) => (
        <Label key={f.key} className="flex-col items-start">
          {f.label}
          <Input
            name={f.key}
            type="number"
            min={0}
            defaultValue={defaults[f.key]}
            placeholder={t("admin.placeholder", { value: String(f.fallback) })}
            disabled={!props.canWrite}
          />
        </Label>
      ))}
    </div>
  );
  return (
    <div
      className="border-card-border bg-surface-card space-y-3 rounded-xl border p-5 shadow-xs"
      data-testid="portfolio-admin-settings"
    >
      <p className="text-12 text-text-secondary">{t("admin.intro")}</p>
      {props.canWrite ? (
        <ActionForm
          action={savePortfolioAdminSettingsAction}
          submitLabel={t("admin.submit")}
          className="space-y-3"
        >
          {inputs}
        </ActionForm>
      ) : (
        inputs
      )}
    </div>
  );
}
