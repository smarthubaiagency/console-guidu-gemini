import { getTranslations } from "next-intl/server";
import type { listLocations } from "@/core/locations/service";

import { sectionClass } from "@/components/billing/billing-ui";
import { ActionForm } from "@/components/partners/action-form";
import { inputClass, labelClass } from "@/components/partners/form-classes";
import {
  DetailsFields,
  formatMoney,
  ITEM_STATUSES,
  labelOf,
  PRICE_DISPLAYS,
  VariantFields,
} from "@/modules/portfolio/components/fields";
import {
  AccommodationTypeFields,
  lodgingLabel,
  RatePlanFields,
} from "@/modules/portfolio/components/lodging-fields";
import {
  translatedItemTypeLabel,
  translatedKindLabel,
  translatedVerticalLabel,
} from "@/modules/portfolio/verticals";
import {
  addPortfolioVariantAction,
  saveAccommodationTypeAction,
  saveRatePlanAction,
  updatePortfolioItemAction,
  updatePortfolioVariantAction,
} from "@/modules/portfolio/server/actions";
import {
  type getItem,
  itemToUcp,
  lodgingProblemCode,
} from "@/modules/portfolio/server";
import { FULFILLMENT_METHODS, isUcpVisible } from "@/modules/portfolio/ucp";

type Item = Awaited<ReturnType<typeof getItem>>;
type Locations = Awaited<ReturnType<typeof listLocations>>;

/** Subtitle of an item: kind, status, variants and handle. */
export async function itemSummary(item: Item): Promise<string> {
  const t = await getTranslations("portfolio");
  return t("item.description", {
    kind: translatedKindLabel(t, item.itemType, item.vertical),
    status: labelOf(t, "status", item.status),
    count: item.variants.length,
    handle: item.handle,
  });
}

/**
 * Editor of one Portfolio item (F5a), shown in the drawer of the list
 * (ADR 0015): UCP fields, governance, variants and preview. Lodging (F5c)
 * adds the property, accommodation types and rate plans, and its variants
 * are nightly prices.
 */
export async function PortfolioItemEditor({
  workspaceSlug,
  item,
  locations,
  canWrite,
}: Readonly<{
  workspaceSlug: string;
  item: Item;
  locations: Locations;
  canWrite: boolean;
}>) {
  const t = await getTranslations("portfolio");
  const ucp = itemToUcp(item);
  const visible = isUcpVisible(item);
  const lodging = item.lodging;
  const problem = lodging
    ? lodgingProblemCode({ ...item, status: "active" })
    : null;
  const toActivate = problem ? t(`errors.lodging.${problem}`) : null;
  const variantPrices = await Promise.all(
    item.variants.map((v) => formatMoney(v.priceAmount, v.currency)),
  );
  const hidden = (
    <>
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="itemId" value={item.id} />
    </>
  );

  return (
    <div className="space-y-6" data-testid="portfolio-item">
      <fieldset disabled={!canWrite} className="space-y-6">
        <section className={sectionClass}>
          <h2 className="text-14 text-text font-semibold">
            {t("item.dataTitle")}
          </h2>
          <ActionForm
            action={updatePortfolioItemAction}
            submitLabel={t("item.save")}
            className="space-y-3"
            testId="edit-portfolio-item"
          >
            {hidden}
            <input type="hidden" name="item_type" value={item.itemType} />
            <input type="hidden" name="vertical" value={item.vertical} />
            <div className="grid gap-3 sm:grid-cols-3">
              <label className={`${labelClass} sm:col-span-2`}>
                {t("form.title")}
                <input
                  name="title"
                  required
                  maxLength={200}
                  defaultValue={item.title}
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                {t("item.handle")}
                <input
                  name="handle"
                  required
                  maxLength={200}
                  defaultValue={item.handle}
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                {t("item.status")}
                <select
                  name="status"
                  defaultValue={item.status}
                  className={inputClass}
                >
                  {ITEM_STATUSES.map((k) => (
                    <option key={k} value={k}>
                      {labelOf(t, "status", k)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                {t("form.priceDisplay")}
                <select
                  name="price_display"
                  defaultValue={item.priceDisplay}
                  className={inputClass}
                >
                  {PRICE_DISPLAYS.map((k) => (
                    <option key={k} value={k}>
                      {labelOf(t, "priceDisplay", k)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                {t("item.visibility")}
                <select
                  name="visibility"
                  defaultValue={item.visibility}
                  className={inputClass}
                >
                  <option value="public">{t("visibility.public")}</option>
                  <option value="internal">{t("visibility.internal")}</option>
                </select>
              </label>
              <label className={`${labelClass} sm:col-span-3`}>
                {t("form.description")}
                <textarea
                  name="description_plain"
                  rows={3}
                  maxLength={10000}
                  defaultValue={item.description.plain ?? ""}
                  className={inputClass}
                />
              </label>
              <label className={`${labelClass} sm:col-span-3`}>
                {t("item.descriptionMarkdown")}
                <textarea
                  name="description_markdown"
                  rows={3}
                  maxLength={10000}
                  defaultValue={item.description.markdown ?? ""}
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                {t("item.categories")}
                <textarea
                  name="categories"
                  rows={3}
                  placeholder={t("item.categoriesPlaceholder")}
                  defaultValue={item.categories
                    .map((c) => `${c.value} | ${c.taxonomy ?? "merchant"}`)
                    .join("\n")}
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                {t("item.media")}
                <textarea
                  name="media"
                  rows={3}
                  defaultValue={item.media
                    .map(
                      (m) => `${m.url}${m.alt_text ? ` | ${m.alt_text}` : ""}`,
                    )
                    .join("\n")}
                  className={inputClass}
                />
                <span className="text-11 text-text-secondary">
                  {t("item.mediaHint")}
                </span>
              </label>
              <div className="space-y-2">
                <label className={labelClass}>
                  {t("item.tags")}
                  <input
                    name="tags"
                    defaultValue={item.tags.join(", ")}
                    className={inputClass}
                  />
                </label>
                <label className={labelClass}>
                  {t("item.url")}
                  <input
                    name="url"
                    type="url"
                    defaultValue={item.url ?? ""}
                    className={inputClass}
                  />
                </label>
              </div>
              <fieldset className="space-y-1">
                <legend className="text-12 text-text-subtle font-medium">
                  {t("item.fulfillment")}
                </legend>
                {FULFILLMENT_METHODS.map((m) => (
                  <label key={m} className="text-12 text-text flex gap-2">
                    <input
                      type="checkbox"
                      name="fulfillment_methods"
                      value={m}
                      defaultChecked={item.fulfillmentMethods.includes(m)}
                    />
                    {labelOf(t, "fulfillment", m)}
                  </label>
                ))}
              </fieldset>
              <fieldset className="space-y-1 sm:col-span-2">
                <legend className="text-12 text-text-subtle font-medium">
                  {lodging ? t("item.property") : t("item.locations")}
                </legend>
                {locations.length === 0 ? (
                  <p className="text-12 text-text-secondary">
                    {t("item.noLocations")}
                  </p>
                ) : lodging ? (
                  <>
                    <label className="text-12 text-text flex gap-2">
                      <input
                        type="radio"
                        name="location_ids"
                        value=""
                        defaultChecked={item.locationIds.length === 0}
                      />
                      {t("item.noProperty")}
                    </label>
                    {locations.map((l) => (
                      <label
                        key={l.id}
                        className="text-12 text-text flex gap-2"
                      >
                        <input
                          type="radio"
                          name="location_ids"
                          value={l.id}
                          defaultChecked={item.locationIds[0] === l.id}
                        />
                        {l.name}
                      </label>
                    ))}
                  </>
                ) : (
                  locations.map((l) => (
                    <label key={l.id} className="text-12 text-text flex gap-2">
                      <input
                        type="checkbox"
                        name="location_ids"
                        value={l.id}
                        defaultChecked={item.locationIds.includes(l.id)}
                      />
                      {l.name}
                    </label>
                  ))
                )}
              </fieldset>
            </div>

            <h3 className="text-12 text-text pt-2 font-semibold">
              {t("item.detailsTitle", {
                kind: `${translatedItemTypeLabel(t, item.itemType).toLowerCase()}${
                  item.vertical === "general"
                    ? ""
                    : ` — ${translatedVerticalLabel(t, item.itemType, item.vertical)}`
                }`,
              })}
            </h3>
            <DetailsFields
              itemType={item.itemType}
              vertical={item.vertical}
              details={item.details}
            />

            <h3 className="text-12 text-text pt-2 font-semibold">
              {t("item.aiTitle")}
            </h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-12 text-text flex items-center gap-2">
                <input
                  type="checkbox"
                  name="ai_discovery_enabled"
                  defaultChecked={item.aiDiscoveryEnabled}
                />
                {t("item.aiDiscovery")}
              </label>
              <label className="text-12 text-text flex items-center gap-2">
                <input
                  type="checkbox"
                  name="is_featured"
                  defaultChecked={item.isFeatured}
                />
                {t("item.featured")}
              </label>
              <label className={labelClass}>
                {t("item.priority")}
                <input
                  name="priority"
                  type="number"
                  defaultValue={item.priority}
                  className={inputClass}
                />
              </label>
              <input
                type="hidden"
                name="featured_rank"
                value={item.featuredRank}
              />
              <label className={labelClass}>
                {t("item.aiKeywords")}
                <input
                  name="ai_keywords"
                  defaultValue={item.aiKeywords.join(", ")}
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                {t("item.aiAliases")}
                <input
                  name="ai_aliases"
                  defaultValue={item.aiAliases.join(", ")}
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                {t("item.aiDoNotSay")}
                <input
                  name="ai_do_not_say"
                  defaultValue={item.aiDoNotSay.join(", ")}
                  className={inputClass}
                />
              </label>
              <label className={`${labelClass} sm:col-span-3`}>
                {t("item.aiSafetyRules")}
                <textarea
                  name="ai_safety_rules"
                  rows={2}
                  maxLength={2000}
                  defaultValue={item.aiSafetyRules ?? ""}
                  className={inputClass}
                />
              </label>
            </div>
          </ActionForm>
        </section>

        {lodging ? (
          <>
            <section className={sectionClass} data-testid="accommodation-types">
              <h2 className="text-14 text-text font-semibold">
                {t("lodging.typesTitle", {
                  count: lodging.accommodationTypes.length,
                })}
              </h2>
              <p className="text-12 text-text-secondary">
                {t("lodging.typesIntro")}
                {toActivate
                  ? ` ${t("lodging.toActivate", { problem: toActivate })}`
                  : ""}
              </p>
              <div className="divide-border divide-y">
                {lodging.accommodationTypes.map((type) => (
                  <div
                    key={type.id}
                    className="space-y-2 py-4"
                    data-testid="accommodation-type"
                  >
                    <p className="text-12 text-text-secondary">
                      <span className="text-text font-semibold">
                        {type.title}
                      </span>
                      {type.accommodationKind
                        ? ` · ${lodgingLabel(t, "accommodationKind", type.accommodationKind)}`
                        : ""}
                      {type.capacity.total
                        ? ` · ${t("lodging.upToGuests", { count: type.capacity.total })}`
                        : ` · ${t("lodging.noCapacity")}`}
                    </p>
                    <ActionForm
                      action={saveAccommodationTypeAction}
                      submitLabel={t("lodging.saveType")}
                      className="space-y-3"
                    >
                      {hidden}
                      <input type="hidden" name="typeId" value={type.id} />
                      <AccommodationTypeFields type={type} />
                    </ActionForm>
                    {lodging.accommodationTypes.length > 1 ? (
                      <ActionForm
                        action={saveAccommodationTypeAction}
                        submitLabel={t("lodging.removeType")}
                        tone="neutral"
                      >
                        {hidden}
                        <input type="hidden" name="typeId" value={type.id} />
                        <input type="hidden" name="remove" value="1" />
                      </ActionForm>
                    ) : null}
                  </div>
                ))}
              </div>
              <h3 className="text-12 text-text pt-2 font-semibold">
                {t("lodging.newType")}
              </h3>
              <ActionForm
                action={saveAccommodationTypeAction}
                submitLabel={t("lodging.addType")}
                className="space-y-3"
                testId="add-accommodation-type"
              >
                {hidden}
                <AccommodationTypeFields />
              </ActionForm>
            </section>

            <section className={sectionClass} data-testid="rate-plans">
              <h2 className="text-14 text-text font-semibold">
                {t("lodging.plansTitle", { count: lodging.ratePlans.length })}
              </h2>
              <p className="text-12 text-text-secondary">
                {t("lodging.plansIntro")}
              </p>
              <div className="divide-border divide-y">
                {lodging.ratePlans.map((p) => (
                  <div
                    key={p.id}
                    className="space-y-2 py-4"
                    data-testid="rate-plan"
                  >
                    <p className="text-12 text-text-secondary">
                      <span className="text-text font-semibold">{p.title}</span>
                      {` · ${lodgingLabel(t, "board", p.board)} · ${lodgingLabel(t, "refundability", p.refundability)}`}
                    </p>
                    <ActionForm
                      action={saveRatePlanAction}
                      submitLabel={t("lodging.savePlan")}
                      className="space-y-3"
                    >
                      {hidden}
                      <input type="hidden" name="planId" value={p.id} />
                      <RatePlanFields plan={p} />
                    </ActionForm>
                    {lodging.ratePlans.length > 1 ? (
                      <ActionForm
                        action={saveRatePlanAction}
                        submitLabel={t("lodging.removePlan")}
                        tone="neutral"
                      >
                        {hidden}
                        <input type="hidden" name="planId" value={p.id} />
                        <input type="hidden" name="remove" value="1" />
                      </ActionForm>
                    ) : null}
                  </div>
                ))}
              </div>
              <h3 className="text-12 text-text pt-2 font-semibold">
                {t("lodging.newPlan")}
              </h3>
              <ActionForm
                action={saveRatePlanAction}
                submitLabel={t("lodging.addPlan")}
                className="space-y-3"
                testId="add-rate-plan"
              >
                {hidden}
                <RatePlanFields />
              </ActionForm>
            </section>
          </>
        ) : null}

        <section className={sectionClass}>
          <h2 className="text-14 text-text font-semibold">
            {t(lodging ? "variants.nightlyTitle" : "variants.title", {
              count: item.variants.length,
            })}
          </h2>
          <div className="divide-border divide-y">
            {item.variants.map((v, index) => (
              <div key={v.id} className="space-y-2 py-4" data-testid="variant">
                <p className="text-12 text-text-secondary">
                  <span className="text-text font-semibold">{v.title}</span> ·{" "}
                  {variantPrices[index]}
                  {index === 0 ? ` · ${t("variants.featured")}` : ""}
                </p>
                <ActionForm
                  action={updatePortfolioVariantAction}
                  submitLabel={t("variants.save")}
                  className="space-y-3"
                >
                  {hidden}
                  <input type="hidden" name="variantId" value={v.id} />
                  <VariantFields
                    variant={v}
                    idPrefix={`variant-${index}`}
                    lodging={lodging}
                  />
                </ActionForm>
                {item.variants.length > 1 ? (
                  <ActionForm
                    action={updatePortfolioVariantAction}
                    submitLabel={t("variants.remove")}
                    tone="neutral"
                  >
                    {hidden}
                    <input type="hidden" name="variantId" value={v.id} />
                    <input type="hidden" name="remove" value="1" />
                  </ActionForm>
                ) : null}
              </div>
            ))}
          </div>
          <h3 className="text-12 text-text pt-2 font-semibold">
            {lodging ? t("variants.newNightly") : t("variants.new")}
          </h3>
          <ActionForm
            action={addPortfolioVariantAction}
            submitLabel={t("variants.add")}
            className="space-y-3"
            testId="add-variant"
          >
            {hidden}
            <VariantFields idPrefix="new-variant" lodging={lodging} />
          </ActionForm>
        </section>
      </fieldset>

      <section className={sectionClass} data-testid="ucp-preview">
        <h2 className="text-14 text-text font-semibold">
          {t("preview.title")}
        </h2>
        <p className="text-12 text-text-secondary">
          {visible
            ? t("preview.visible")
            : item.priceDisplay === "quote"
              ? t("preview.quote")
              : t("preview.hidden")}
        </p>
        {ucp ? (
          <pre className="bg-surface-raised text-11 max-h-96 overflow-auto rounded-lg p-3">
            {JSON.stringify(ucp, null, 2)}
          </pre>
        ) : null}
      </section>
    </div>
  );
}
