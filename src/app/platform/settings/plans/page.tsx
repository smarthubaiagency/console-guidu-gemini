import type { Metadata } from "next";
import { Gauge } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { ActionForm } from "@/components/partners/action-form";
import { LimitsTable } from "@/components/plans/limits-table";
import { SettingsCard } from "@/components/settings/settings-shell";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import {
  publishPlanLimitsAction,
  saveQuotaCeilingsAction,
} from "@/core/billing/actions";
import { loadPlansLimits } from "@/core/billing/limits";
import { getQuotaTexts } from "@/core/entitlements/labels";
import { platformGrants } from "@/core/module-runtime/loaders";
import { getRequestPartner } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("plans");
  return { title: t("metaTitle") };
}

/**
 * Plataforma › Configurações › Planos e limites (CF4): the catalog of quota
 * keys with the default without a plan, the platform ceilings and the
 * value of each plan on sale. Billing readers see it; billing managers
 * (owner and billing) change ceilings and publish plan limits.
 */
export default async function PlatformPlansLimitsPage() {
  const identity = await requirePlatformAdminPage("/platform/settings/plans");
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  const role = admin?.status === "active" ? admin.role : null;
  const grants = platformGrants(role);
  if (!grants("platform.billing.read")) {
    return <ModuleNotice variant="denied" />;
  }
  const canManage = grants("platform.billing.manage");
  const partner = await getRequestPartner();
  const view = await withIdentityContext(
    prisma,
    identity.userId,
    (tx) => loadPlansLimits(tx),
    { partnerId: partner?.partnerId ?? null },
  );
  const t = await getTranslations("plans");
  const texts = await getQuotaTexts();
  const ceilings = new Map(
    view.rows.map((row) => [row.entry.key, row.ceiling]),
  );

  return (
    <>
      <ModulePageHeader
        title={t("title")}
        description={t("description.platform")}
        icon={<Gauge className="h-5 w-5" />}
      />

      <SettingsCard
        title={t("catalog.title")}
        description={t("catalog.description")}
        testId="plans-catalog"
      >
        <LimitsTable view={view} showCeiling />
        {view.plans.length === 0 ? (
          <p className="text-12 text-text-secondary">{t("catalog.noPlans")}</p>
        ) : null}
        {canManage ? null : (
          <p className="text-12 text-text-secondary">{t("readOnly")}</p>
        )}
      </SettingsCard>

      {canManage ? (
        <SettingsCard
          title={t("ceilings.title")}
          description={t("ceilings.description")}
        >
          <ActionForm
            action={saveQuotaCeilingsAction}
            submitLabel={t("ceilings.save")}
            className="grid gap-3 sm:grid-cols-2"
            testId="quota-ceilings"
          >
            {view.rows.map(({ entry, ceiling }) => (
              <Label key={entry.key} className="flex-col items-start">
                {t("ceilings.label", { quota: texts.label(entry) })}
                <Input
                  name={`ceiling.${entry.key}`}
                  inputMode="numeric"
                  placeholder={t("ceilings.placeholder")}
                  defaultValue={ceiling === null ? "" : String(ceiling)}
                />
              </Label>
            ))}
          </ActionForm>
        </SettingsCard>
      ) : null}

      {canManage
        ? view.plans.map((plan) => (
            <SettingsCard
              key={plan.planId}
              title={t("planForm.title", {
                plan: plan.planName,
                version: plan.version,
              })}
              description={t("planForm.description", {
                next: plan.version + 1,
              })}
            >
              <ActionForm
                action={publishPlanLimitsAction}
                submitLabel={t("planForm.submit")}
                className="grid gap-3 sm:grid-cols-2"
                testId={`plan-limits-${plan.planKey}`}
              >
                <input type="hidden" name="planId" value={plan.planId} />
                {view.rows.map(({ entry }) => {
                  const value = Object.hasOwn(plan.limits, entry.key)
                    ? plan.limits[entry.key]
                    : undefined;
                  const ceiling = ceilings.get(entry.key) ?? null;
                  const canBeUnlimited =
                    entry.unlimitedAllowed && ceiling === null;
                  return (
                    <div key={entry.key} className="space-y-1">
                      <Label className="flex-col items-start">
                        <span>
                          {texts.label(entry)}
                          {ceiling !== null
                            ? ` (${t("planForm.ceilingHint", { ceiling })})`
                            : ""}
                        </span>
                        <Input
                          name={`limit.${entry.key}`}
                          inputMode="numeric"
                          placeholder={t("planForm.placeholder")}
                          defaultValue={
                            typeof value === "number" ? String(value) : ""
                          }
                        />
                      </Label>
                      {canBeUnlimited ? (
                        <Label className="text-12 text-text-subtle font-normal">
                          <Checkbox
                            name={`unlimited.${entry.key}`}
                            defaultChecked={value === null}
                            aria-label={`${t("planForm.unlimited")}: ${texts.label(entry)}`}
                          />
                          {t("planForm.unlimited")}
                        </Label>
                      ) : null}
                    </div>
                  );
                })}
              </ActionForm>
            </SettingsCard>
          ))
        : null}
    </>
  );
}
