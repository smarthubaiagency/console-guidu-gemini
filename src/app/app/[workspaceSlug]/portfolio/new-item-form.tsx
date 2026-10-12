import { getTranslations } from "next-intl/server";

import { ActionForm } from "@/components/partners/action-form";
import {
  labelOf,
  PRICE_DISPLAYS,
  VariantFields,
} from "@/modules/portfolio/components/fields";
import { createPortfolioItemAction } from "@/modules/portfolio/server/actions";
import { translatedKinds } from "@/modules/portfolio/verticals";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

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
        <Label className="flex-col items-start">
          {t("form.kind")}
          <NativeSelect
            name="kind"
            defaultValue="product:general"
            className="w-full"
          >
            {translatedKinds(t).map((k) => (
              <NativeSelectOption key={k.value} value={k.value}>
                {k.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Label>
        <Label className="flex-col items-start">
          {t("form.title")}
          <Input name="title" required maxLength={200} />
        </Label>
        <Label className="flex-col items-start">
          {t("form.priceDisplay")}
          <NativeSelect
            name="price_display"
            defaultValue="price"
            className="w-full"
          >
            {PRICE_DISPLAYS.map((k) => (
              <NativeSelectOption key={k} value={k}>
                {labelOf(t, "priceDisplay", k)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Label>
        <Label className="flex-col items-start sm:col-span-3">
          {t("form.description")}
          <Textarea name="description_plain" rows={2} maxLength={10000} />
        </Label>
      </div>
      <VariantFields idPrefix="new" />
      <p className="text-11 text-text-secondary">{t("list.createHint")}</p>
    </ActionForm>
  );
}
