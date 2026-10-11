import {
  ActionForm,
  inputClass,
  labelClass,
} from "@/components/partners/action-form";
import type { ModuleSettingsComponentProps } from "@/core/module-contracts/settings";

import {
  PORTFOLIO_DEFAULT_ITEM_LIMIT,
  PORTFOLIO_DEFAULT_VARIANT_LIMIT,
  PortfolioQuotas,
} from "../manifest";
import { savePortfolioAdminSettingsAction } from "../server/actions";

/**
 * Admin settings of the Portfolio (portfolio.admin-settings): default
 * quotas for companies whose plan does not set them. A plan limit, set in
 * Plataforma › Cobrança, always wins.
 */
export function PortfolioAdminSettings(props: ModuleSettingsComponentProps) {
  const defaults =
    (props.config.quotaDefaults as Record<string, number> | undefined) ?? {};
  const fields = [
    {
      key: PortfolioQuotas.ITEMS,
      label: "Itens por workspace",
      fallback: PORTFOLIO_DEFAULT_ITEM_LIMIT,
    },
    {
      key: PortfolioQuotas.VARIANTS,
      label: "Variantes por workspace",
      fallback: PORTFOLIO_DEFAULT_VARIANT_LIMIT,
    },
  ];
  const inputs = (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((f) => (
        <label key={f.key} className={labelClass}>
          {f.label}
          <input
            name={f.key}
            type="number"
            min={0}
            defaultValue={defaults[f.key]}
            placeholder={`Padrão do módulo: ${f.fallback}`}
            disabled={!props.canWrite}
            className={inputClass}
          />
        </label>
      ))}
    </div>
  );
  return (
    <div
      className="border-card-border bg-surface-card space-y-3 rounded-xl border p-5 shadow-xs"
      data-testid="portfolio-admin-settings"
    >
      <p className="text-12 text-text-secondary">
        Limites usados quando o plano da empresa não define um. Vazio volta ao
        padrão do módulo.
      </p>
      {props.canWrite ? (
        <ActionForm
          action={savePortfolioAdminSettingsAction}
          submitLabel="Salvar limites"
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
