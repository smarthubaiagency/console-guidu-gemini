import { getTranslations } from "next-intl/server";

import { ActionForm } from "@/components/partners/action-form";
import { inputClass, labelClass } from "@/components/partners/form-classes";
import {
  labelOf,
  PRICE_DISPLAYS,
  VariantFields,
} from "@/modules/portfolio/components/fields";
import { createPortfolioItemAction } from "@/modules/portfolio/server/actions";
import { translatedKinds } from "@/modules/portfolio/verticals";

/**
 * Creation of a Portfolio item (F5a), in the drawer of the list (ADR 0015).
 * After saving, the drawer goes to the editor of the new item.
 */
export async function NewItemForm({
  workspaceSlug,
}: Readonly<{ workspaceSlug: string }>) {
  const t = await getTranslations("portfolio");
  return (
    <ActionForm
      action={createPortfolioItemAction}
      submitLabel={t("list.create")}
      className="space-y-3"
      testId="create-portfolio-item"
    >
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={labelClass}>
          {t("form.kind")}
          <select
            name="kind"
            defaultValue="product:general"
            className={inputClass}
          >
            {translatedKinds(t).map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          {t("form.title")}
          <input name="title" required maxLength={200} className={inputClass} />
        </label>
        <label className={labelClass}>
          {t("form.priceDisplay")}
          <select
            name="price_display"
            defaultValue="price"
            className={inputClass}
          >
            {PRICE_DISPLAYS.map((k) => (
              <option key={k} value={k}>
                {labelOf(t, "priceDisplay", k)}
              </option>
            ))}
          </select>
        </label>
        <label className={`${labelClass} sm:col-span-3`}>
          {t("form.description")}
          <textarea
            name="description_plain"
            rows={2}
            maxLength={10000}
            className={inputClass}
          />
        </label>
      </div>
      <VariantFields idPrefix="new" />
      <p className="text-11 text-text-secondary">{t("list.createHint")}</p>
    </ActionForm>
  );
}
