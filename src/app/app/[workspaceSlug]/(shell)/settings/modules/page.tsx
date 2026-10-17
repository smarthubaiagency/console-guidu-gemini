import Link from "next/link";
import { Puzzle } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { WorkspaceModuleToggle } from "@/components/modules/module-status-forms";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { NavIcon } from "@/components/layout/nav-icons";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { requireUserPage } from "@/core/auth/page-guard";
import { loadWorkspaceModuleViews } from "@/core/module-runtime/loaders";
import { moduleStateLabelKey } from "@/core/module-runtime/state";
import { getModuleCatalog } from "@/core/i18n/modules";
import { prisma } from "@/lib/prisma/client";
import { requireWorkspaceAreaPage } from "@/core/module-runtime/page-access";

export async function generateMetadata() {
  const t = await getTranslations("modules");
  return { title: t("metaTitle") };
}

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

const STATE_STYLES: Record<string, string> = {
  enabled: "bg-success-bg text-success-text",
  maintenance: "bg-warning-bg text-warning-text",
  coming_soon: "bg-info-bg text-info-text",
  not_enabled: "bg-surface-hover text-text-subtle",
};

/** Enablement and state index of the workspace modules (ADR 0005). */
export default async function ModulesSettingsPage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const identity = await requireUserPage(
    `/app/${workspaceSlug}/settings/modules`,
  );
  const context = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );
  // Areas beyond the dashboard need workspace.read (AT1).
  await requireWorkspaceAreaPage(context);
  const { modules, canManage } = await loadWorkspaceModuleViews(
    prisma,
    context,
    workspaceSlug,
  );
  const t = await getTranslations("modules");
  const catalog = await getModuleCatalog();
  const named = modules.map((m) => ({
    ...m,
    displayName: catalog.name(m.moduleKey, m.displayName),
    description: catalog.description(m.moduleKey, m.description),
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <ModulePageHeader
        title={t("title")}
        description={t("description")}
        icon={<Puzzle className="h-5 w-5" />}
      />

      {!canManage && (
        <p className="text-12 text-text-secondary">{t("manageHint")}</p>
      )}

      <ul className="border-card-border bg-surface-card divide-border divide-y rounded-xl border shadow-xs">
        {named.map((m) => (
          <li
            key={m.moduleKey}
            className="flex items-center justify-between gap-4 p-4"
          >
            <div className="flex items-start gap-3">
              <div className="bg-surface-hover text-text-subtle rounded-lg p-2">
                <NavIcon iconKey={m.iconKey} className="h-4 w-4" />
              </div>
              <div>
                <div className="text-14 text-text font-semibold">
                  {m.displayName}
                </div>
                <div className="text-12 text-text-secondary">
                  {m.description}
                </div>
                <div className="text-11 text-text-tertiary font-mono">
                  key: {m.moduleKey}
                </div>
                {m.hasWorkspaceSettings && m.state === "enabled" && (
                  <Link
                    href={`/app/${workspaceSlug}/settings/modules/${m.moduleKey}`}
                    className="text-12 text-text-subtle hover:text-text mt-1 inline-block font-medium underline"
                  >
                    {t("configure", { name: m.displayName })}
                  </Link>
                )}
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <span
                className={`text-12 rounded-full px-2.5 py-1 font-medium ${
                  STATE_STYLES[m.state] ?? STATE_STYLES.not_enabled
                }`}
              >
                {t(`states.${moduleStateLabelKey(m.state, m.releaseStatus)}`)}
              </span>
              {m.canToggle && (
                <WorkspaceModuleToggle
                  workspaceSlug={workspaceSlug}
                  moduleKey={m.moduleKey}
                  moduleName={m.displayName}
                  enabled={m.state === "enabled" || m.state === "maintenance"}
                />
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
