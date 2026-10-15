import type { Metadata } from "next";
import Link from "next/link";
import { Code2 } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { KeyUsageTables } from "@/components/api/key-usage-table";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { ActionForm } from "@/components/partners/action-form";
import { SettingsCard } from "@/components/settings/settings-shell";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { platformApiView, platformKeyUsage } from "@/core/api/settings";
import {
  saveApiSwitchesAction,
  savePlanScopesAction,
} from "@/core/api/settings-actions";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { SCOPE_DEFINITIONS } from "@/core/mcp/scopes";
import { platformGrants } from "@/core/module-runtime/loaders";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("apiSettings");
  return { title: t("metaTitle") };
}

/**
 * Plataforma › Configurações › API e MCP (CF6b): the emergency switches,
 * the limits per minute (environment default, ceiling and plans, edited in
 * Planos e limites), the scopes of each plan and the usage per key.
 */
export default async function PlatformApiSettingsPage() {
  const identity = await requirePlatformAdminPage("/platform/settings/api");
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  const role = admin?.status === "active" ? admin.role : null;
  if (!platformGrants(role)("platform.settings.manage")) {
    return <ModuleNotice variant="denied" />;
  }
  const actor = { userId: identity.userId, platformRole: role };
  const { view, usage } = await withIdentityContext(
    prisma,
    identity.userId,
    async (tx) => ({
      view: await platformApiView(tx, actor),
      usage: await platformKeyUsage(tx, actor),
    }),
  );
  const t = await getTranslations("apiSettings");
  const tMcp = await getTranslations("mcp");
  const format = await getFormatter();
  const scopeLabel = (id: string) => {
    const key = `scopes.${id.replace(/:/g, "_")}.label`;
    return tMcp.has(key) ? tMcp(key) : id;
  };
  const value = (n: number | null) =>
    n === null ? t("limits.default") : format.number(n);

  return (
    <>
      <ModulePageHeader
        title={t("title")}
        description={t("description")}
        icon={<Code2 className="h-5 w-5" />}
      />

      <SettingsCard
        title={t("switches.title")}
        description={t("switches.description")}
        testId="api-switches"
      >
        {view.canEdit ? (
          <ActionForm
            action={saveApiSwitchesAction}
            submitLabel={t("save")}
            className="flex flex-col items-start gap-3"
          >
            <Label className="text-14 gap-2 font-normal">
              <Checkbox
                name="api"
                defaultChecked={view.switches.api}
                data-testid="api-switch-rest"
              />
              {t("switches.api")}
            </Label>
            <Label className="text-14 gap-2 font-normal">
              <Checkbox
                name="mcp"
                defaultChecked={view.switches.mcp}
                data-testid="api-switch-mcp"
              />
              {t("switches.mcp")}
            </Label>
            <p className="text-12 text-text-secondary">{t("switches.hint")}</p>
          </ActionForm>
        ) : (
          <p className="text-14">
            {view.switches.api ? t("switches.apiOn") : t("switches.apiOff")} ·{" "}
            {view.switches.mcp ? t("switches.mcpOn") : t("switches.mcpOff")}
          </p>
        )}
      </SettingsCard>

      <SettingsCard
        title={t("limits.title")}
        description={t("limits.description")}
        testId="api-limits"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("limits.bucket")}</TableHead>
              <TableHead>{t("limits.env")}</TableHead>
              <TableHead>{t("limits.ceiling")}</TableHead>
              {view.limits[0]?.plans.map((plan) => (
                <TableHead key={plan.planName}>{plan.planName}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.limits.map((row) => (
              <TableRow
                key={row.bucket}
                data-testid={`api-limit-${row.bucket}`}
              >
                <TableCell className="whitespace-normal">
                  <span className="text-text font-medium">
                    {t(`limits.buckets.${row.bucket}`)}
                  </span>
                  <div className="text-11 text-text-secondary">
                    <code>{row.quotaKey}</code>
                  </div>
                </TableCell>
                <TableCell>{format.number(row.defaultValue)}</TableCell>
                <TableCell>
                  {row.ceiling === null
                    ? t("limits.noCeiling")
                    : format.number(row.ceiling)}
                </TableCell>
                {row.plans.map((plan) => (
                  <TableCell key={plan.planName}>{value(plan.value)}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-12 text-text-secondary">
          {t.rich("limits.edit", {
            link: (chunks) => (
              <Link
                href="/platform/settings/plans"
                className="text-primary font-semibold"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      </SettingsCard>

      <SettingsCard
        title={t("scopes.title")}
        description={t("scopes.description")}
        testId="api-plan-scopes"
      >
        {view.plans.length === 0 ? (
          <p className="text-12 text-text-secondary">{t("scopes.noPlans")}</p>
        ) : view.canEdit ? (
          <ActionForm
            action={savePlanScopesAction}
            submitLabel={t("save")}
            className="flex flex-col items-start gap-6"
          >
            {view.plans.map((plan) => (
              <fieldset
                key={plan.planKey}
                className="grid gap-2"
                data-testid={`api-plan-scopes-${plan.planKey}`}
              >
                <input type="hidden" name="plan" value={plan.planKey} />
                <legend className="text-14 text-text mb-1 font-semibold">
                  {plan.planName}{" "}
                  <span className="text-12 text-text-secondary font-normal">
                    {plan.custom ? t("scopes.custom") : t("scopes.all")}
                  </span>
                </legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {SCOPE_DEFINITIONS.map((scope) => (
                    <Label key={scope.id} className="text-12 gap-2 font-normal">
                      <Checkbox
                        name={`scope:${plan.planKey}`}
                        value={scope.id}
                        defaultChecked={plan.scopes.includes(scope.id)}
                        data-testid={`api-scope-${plan.planKey}-${scope.id}`}
                      />
                      <span>
                        {scopeLabel(scope.id)}{" "}
                        <code className="text-11">{scope.id}</code>
                      </span>
                    </Label>
                  ))}
                </div>
              </fieldset>
            ))}
            <p className="text-12 text-text-secondary">{t("scopes.hint")}</p>
          </ActionForm>
        ) : (
          <ul className="text-14 space-y-1">
            {view.plans.map((plan) => (
              <li key={plan.planKey}>
                {plan.planName}: {plan.scopes.join(", ")}
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>

      <SettingsCard
        title={t("usage.title")}
        description={t("usage.description.platform", { days: usage.days })}
        testId="api-key-usage"
      >
        <KeyUsageTables usage={usage} showWhere />
      </SettingsCard>
    </>
  );
}
