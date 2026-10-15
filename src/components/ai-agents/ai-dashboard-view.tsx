import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { SettingsCard } from "@/components/settings/settings-shell";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  type AiDashboard,
  DASHBOARD_PERIODS,
  type GroupUsage,
} from "@/core/ai/dashboard";
import { AI_PROVIDERS } from "@/core/ai/models";
import { cn } from "@/lib/utils";

/**
 * IA › Painel (CF6a), shared by the platform (by partner) and the partner
 * (by customer): summary cards, notices, usage by provider and by group.
 * The period is a link (`?days=7|30`), so the page stays a server page.
 */
export async function AiDashboardView({
  dashboard,
  base,
  groupLabel,
  groupKind,
}: Readonly<{
  dashboard: AiDashboard;
  base: string;
  groupLabel: string;
  groupKind: "partner" | "customer";
}>) {
  const t = await getTranslations("aiConsole");
  const format = await getFormatter();
  const number = (value: number) => format.number(value);
  const rate = (errors: number, requests: number) =>
    errors + requests === 0
      ? t("dashboard.none")
      : format.number(errors / (errors + requests), {
          style: "percent",
          maximumFractionDigits: 1,
        });
  const groupName = (group: GroupUsage) => {
    if (group.id === null) {
      return groupKind === "partner"
        ? t("dashboard.noPartner")
        : t("dashboard.ownAssistant");
    }
    return group.name ?? t("dashboard.unknown");
  };
  const { totals } = dashboard;

  const cards = [
    {
      key: "providers",
      label: t("dashboard.cards.providers"),
      value: t("dashboard.cards.providersValue", {
        enabled: dashboard.providersEnabled,
        total: AI_PROVIDERS.length,
      }),
    },
    {
      key: "requests",
      label: t("dashboard.cards.requests"),
      value: number(totals.requests),
    },
    {
      key: "tokens",
      label: t("dashboard.cards.tokens"),
      value: number(totals.inputTokens + totals.outputTokens),
    },
    {
      key: "errors",
      label: t("dashboard.cards.errors"),
      value: number(totals.errors),
    },
    {
      key: "notices",
      label: t("dashboard.cards.notices"),
      value: number(dashboard.notices.length),
    },
  ];

  return (
    <div className="space-y-6" data-testid="ai-dashboard">
      <nav
        aria-label={t("dashboard.period")}
        className="flex flex-wrap items-center gap-2"
      >
        <span className="text-12 text-text-secondary">
          {t("dashboard.period")}
        </span>
        {DASHBOARD_PERIODS.map((days) => (
          <Link
            key={days}
            href={`${base}?days=${days}`}
            aria-current={dashboard.days === days ? "page" : undefined}
            className={cn(
              "text-12 rounded-md border px-2 py-1",
              dashboard.days === days
                ? "border-primary text-text font-semibold"
                : "border-border text-text-secondary hover:text-text",
            )}
          >
            {t(`dashboard.days${days}`)}
          </Link>
        ))}
      </nav>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((card) => (
          <div
            key={card.key}
            className="border-card-border bg-surface-card rounded-xl border p-4 shadow-xs"
            data-testid={`ai-card-${card.key}`}
          >
            <p className="text-12 text-text-secondary">{card.label}</p>
            <p className="text-20 text-text font-bold">{card.value}</p>
          </div>
        ))}
      </div>

      <SettingsCard title={t("dashboard.noticesTitle")} testId="ai-notices">
        {dashboard.notices.length === 0 ? (
          <p className="text-12 text-text-secondary">
            {t("dashboard.noNotices")}
          </p>
        ) : (
          <ul className="space-y-2">
            {dashboard.notices.map((notice) => (
              <li
                key={`${notice.kind}-${notice.provider ?? ""}`}
                className="text-12 text-text flex items-start gap-2"
                data-testid={`ai-notice-${notice.kind}`}
              >
                <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" />
                {t(`dashboard.notices.${notice.kind}`, {
                  count: notice.count,
                  provider: notice.provider
                    ? t(`providers.${notice.provider}`)
                    : "",
                })}
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>

      <SettingsCard title={t("dashboard.byProvider")} testId="ai-by-provider">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("dashboard.columns.provider")}</TableHead>
              <TableHead>{t("dashboard.columns.status")}</TableHead>
              <TableHead className="text-right">
                {t("dashboard.columns.requests")}
              </TableHead>
              <TableHead className="text-right">
                {t("dashboard.columns.errors")}
              </TableHead>
              <TableHead className="text-right">
                {t("dashboard.columns.errorRate")}
              </TableHead>
              <TableHead className="text-right">
                {t("dashboard.columns.tokens")}
              </TableHead>
              <TableHead>{t("dashboard.columns.topError")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dashboard.providers.map((row) => (
              <TableRow
                key={row.provider}
                data-testid={`ai-provider-row-${row.provider}`}
              >
                <TableCell className="font-medium">
                  {t(`providers.${row.provider}`)}
                </TableCell>
                <TableCell>
                  <Badge variant={row.enabled ? "secondary" : "outline"}>
                    {row.enabled ? t("dashboard.on") : t("dashboard.off")}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {number(row.requests)}
                </TableCell>
                <TableCell className="text-right">
                  {number(row.errors)}
                </TableCell>
                <TableCell className="text-right">
                  {rate(row.errors, row.requests)}
                </TableCell>
                <TableCell className="text-right">
                  {number(row.inputTokens + row.outputTokens)}
                </TableCell>
                <TableCell>
                  {row.topError ? (
                    <code className="text-12">{row.topError}</code>
                  ) : (
                    t("dashboard.none")
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SettingsCard>

      <SettingsCard title={groupLabel} testId="ai-by-group">
        {dashboard.groups.length === 0 ? (
          <p className="text-12 text-text-secondary">{t("dashboard.empty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  {groupKind === "partner"
                    ? t("dashboard.columns.partner")
                    : t("dashboard.columns.customer")}
                </TableHead>
                <TableHead className="text-right">
                  {t("dashboard.columns.requests")}
                </TableHead>
                <TableHead className="text-right">
                  {t("dashboard.columns.errors")}
                </TableHead>
                <TableHead className="text-right">
                  {t("dashboard.columns.errorRate")}
                </TableHead>
                <TableHead className="text-right">
                  {t("dashboard.columns.tokens")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashboard.groups.map((group) => (
                <TableRow key={group.id ?? "none"} data-testid="ai-group-row">
                  <TableCell className="font-medium">
                    {groupName(group)}
                  </TableCell>
                  <TableCell className="text-right">
                    {number(group.requests)}
                  </TableCell>
                  <TableCell className="text-right">
                    {number(group.errors)}
                  </TableCell>
                  <TableCell className="text-right">
                    {rate(group.errors, group.requests)}
                  </TableCell>
                  <TableCell className="text-right">
                    {number(group.inputTokens + group.outputTokens)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SettingsCard>
    </div>
  );
}
