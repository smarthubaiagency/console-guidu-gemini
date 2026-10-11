import { Gauge } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { sectionClass } from "@/components/billing/billing-ui";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { requireUserPage } from "@/core/auth/page-guard";
import { loadUsage, type UsageRow } from "@/core/entitlements/usage";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";

export async function generateMetadata() {
  const t = await getTranslations("usage");
  return { title: t("metaTitle") };
}

interface UsagePageProps {
  params: Promise<{ workspaceSlug: string }>;
}

/** Rows of the platform itself have a translated label (I2). */
const ROW_LABEL_KEYS: Record<string, string> = {
  "core.seats": "rows.coreSeats",
};

type Translate = Awaited<ReturnType<typeof getTranslations<"usage">>>;

function UsageMeter({ row, t }: { row: UsageRow; t: Translate }) {
  const labelKey = ROW_LABEL_KEYS[row.key];
  const label = labelKey ? t(labelKey) : row.label;
  const percent =
    row.used !== null && row.limit
      ? Math.min(100, Math.round((row.used / row.limit) * 100))
      : null;
  const over = row.used !== null && row.limit !== null && row.used > row.limit;
  return (
    <li className="space-y-2 py-3" data-testid={`usage-${row.key}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-14 text-text font-semibold">{label}</span>
        <span className="text-14 text-text font-bold" data-testid="usage-value">
          {row.used === null
            ? t("noData")
            : row.limit === null
              ? `${row.used}`
              : `${row.used} / ${row.limit}`}
        </span>
      </div>
      {percent !== null ? (
        <progress
          className={`progress-bar ${over ? "text-danger-solid" : "text-primary"}`}
          value={percent}
          max={100}
          aria-label={label}
        />
      ) : null}
      <div className="text-12 text-text-secondary">
        {row.scope === "organization"
          ? t("scope.organization")
          : t("scope.workspace")}{" "}
        · {t(`source.${row.source}`)}
        {over ? ` · ${t("overLimit")}` : ""}
      </div>
    </li>
  );
}

/**
 * Real usage against the company's plan (F3b, Especificação §18 e §22).
 * Every number is measured on the server; nothing is simulated.
 */
export default async function UsagePage({ params }: UsagePageProps) {
  const { workspaceSlug } = await params;
  const identity = await requireUserPage(
    `/app/${workspaceSlug}/settings/usage`,
  );
  const context = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );
  const usage = await withContext(prisma, context, (tx) =>
    loadUsage(tx, context),
  );
  const contract = usage.contract;
  const t = await getTranslations("usage");

  return (
    <div className="mx-auto max-w-4xl space-y-6" data-testid="usage-page">
      <ModulePageHeader
        trail={[t("breadcrumbSettings"), t("breadcrumbUsage")]}
        title={t("title")}
        description={t("description")}
        icon={<Gauge className="h-5 w-5" />}
      />

      <section className={sectionClass} data-testid="usage-plan">
        <h2 className="text-14 text-text font-semibold">{t("plan")}</h2>
        <p className="text-12 text-text-secondary">
          {contract.kind === "legacy"
            ? t("legacy")
            : `${t("planSummary", {
                name: contract.planName,
                version: contract.planVersion,
                status: t(`subscriptionStatus.${contract.status}`),
              })}${contract.provisional ? ` · ${t("provisional")}` : ""}`}
        </p>
      </section>

      <section className={sectionClass}>
        <h2 className="text-14 text-text font-semibold">{t("limits")}</h2>
        <ul className="divide-border divide-y">
          {usage.rows.map((row) => (
            <UsageMeter key={row.key} row={row} t={t} />
          ))}
        </ul>
      </section>
    </div>
  );
}
