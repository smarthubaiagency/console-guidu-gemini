import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PlansLimitsView } from "@/core/billing/limits";
import { getQuotaTexts } from "@/core/entitlements/labels";

/**
 * The quota catalog as a table (CF4): one row per key with the default
 * without a plan, optionally the platform ceiling, and one column per plan
 * on sale (current version). Shared by /platform and /admin.
 */
export async function LimitsTable({
  view,
  showCeiling,
}: Readonly<{ view: PlansLimitsView; showCeiling: boolean }>) {
  const t = await getTranslations("plans");
  const texts = await getQuotaTexts();
  return (
    <Table data-testid="limits-catalog">
      <TableHeader>
        <TableRow>
          <TableHead>{t("catalog.quota")}</TableHead>
          <TableHead>{t("catalog.default")}</TableHead>
          {showCeiling ? <TableHead>{t("catalog.ceiling")}</TableHead> : null}
          {view.plans.map((plan) => (
            <TableHead key={plan.planId}>
              {t("catalog.planColumn", {
                plan: plan.planName,
                version: plan.version,
              })}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {view.rows.map(({ entry, defaultLimit, ceiling }) => (
          <TableRow key={entry.key} data-testid={`limits-row-${entry.key}`}>
            <TableCell className="align-top whitespace-normal">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-text font-medium">
                  {texts.label(entry)}
                </span>
                {entry.status === "planned" ? (
                  <Badge variant="outline">{t("planned")}</Badge>
                ) : null}
              </div>
              <div className="text-12 text-text-secondary">
                {texts.description(entry)} · {texts.scope(entry)} ·{" "}
                <code className="text-11">{entry.key}</code>
              </div>
            </TableCell>
            <TableCell className="align-top">
              {entry.defaultSource === "company"
                ? t("values.companySeats")
                : entry.defaultSource === "none"
                  ? t("values.none")
                  : texts.value(entry, defaultLimit)}
            </TableCell>
            {showCeiling ? (
              <TableCell className="align-top" data-testid="limits-ceiling">
                {ceiling === null
                  ? t("values.noCeiling")
                  : texts.value(entry, ceiling)}
              </TableCell>
            ) : null}
            {view.plans.map((plan) => (
              <TableCell
                key={plan.planId}
                className="align-top"
                data-testid={`limits-plan-${plan.planKey}`}
              >
                {Object.hasOwn(plan.limits, entry.key)
                  ? texts.value(entry, plan.limits[entry.key] ?? null)
                  : t("values.default")}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
