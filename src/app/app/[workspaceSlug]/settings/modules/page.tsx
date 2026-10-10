import type { Metadata } from "next";
import Link from "next/link";
import { Puzzle } from "lucide-react";

import { WorkspaceModuleToggle } from "@/components/modules/module-status-forms";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { NavIcon } from "@/components/layout/nav-icons";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { requireUserPage } from "@/core/auth/page-guard";
import { loadWorkspaceModuleViews } from "@/core/module-runtime/loaders";
import { prisma } from "@/lib/prisma/client";

export const metadata: Metadata = { title: "Módulos do Workspace" };

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
  const { modules, canManage } = await loadWorkspaceModuleViews(
    prisma,
    context,
    workspaceSlug,
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <ModulePageHeader
        trail={["Configurações", "Módulos"]}
        title="Habilitação e Estado dos Módulos"
        description="Módulos registrados na plataforma, seu estado neste workspace e o acesso às configurações."
        icon={<Puzzle className="h-5 w-5" />}
      />

      {!canManage && (
        <p className="text-12 text-text-secondary">
          Somente proprietários e administradores do workspace habilitam ou
          desabilitam módulos.
        </p>
      )}

      <ul className="border-card-border bg-surface-card divide-border divide-y rounded-xl border shadow-xs">
        {modules.map((m) => (
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
                    Configurar {m.displayName}
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
                {m.stateLabel}
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
