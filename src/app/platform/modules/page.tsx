import type { Metadata } from "next";
import Link from "next/link";
import { Puzzle } from "lucide-react";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { PlatformAvailabilityForm } from "@/components/modules/module-status-forms";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { platformGrants } from "@/core/module-runtime/loaders";
import { loadPlatformModuleStates } from "@/core/module-runtime/state";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { listRegisteredModules } from "@/modules/registry";

export const metadata: Metadata = { title: "Módulos (Admin)" };

const RELEASE_LABELS: Record<string, string> = {
  coming_soon: "Em breve",
  beta: "Beta",
  available: "Disponível",
  maintenance: "Manutenção (código)",
};

/** Availability, beta, maintenance and rollout of modules (ADR 0005). */
export default async function AdminModulesPage() {
  const identity = await requirePlatformAdminPage("/platform/modules");
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  const grants = platformGrants(admin?.role ?? null);

  if (!grants("platform.modules.read")) {
    return <ModuleNotice variant="denied" />;
  }
  const canManage = grants("platform.modules.manage");

  const states = await withIdentityContext(prisma, identity.userId, (tx) =>
    loadPlatformModuleStates(tx),
  );
  const modules = listRegisteredModules().filter((m) => m.technicalGate());

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <ModulePageHeader
        trail={["Administração", "Módulos"]}
        title="Módulos da Plataforma"
        description="Estado de lançamento do código e disponibilidade global para os clientes."
        icon={<Puzzle className="h-5 w-5" />}
      />
      <ul className="border-card-border bg-surface-card divide-border divide-y rounded-xl border shadow-xs">
        {modules.map(({ manifest }) => {
          const availability =
            states.get(manifest.moduleKey)?.availability ?? "enabled";
          const hasAdminSettings = manifest.settings.some(
            (s) => s.destination === "admin",
          );
          return (
            <li
              key={manifest.moduleKey}
              className="flex items-center justify-between gap-4 p-4"
            >
              <div>
                <div className="text-14 text-text font-semibold">
                  {manifest.displayName}
                </div>
                <div className="text-12 text-text-secondary">
                  v{manifest.moduleVersion} · contrato{" "}
                  {manifest.contractVersion} ·{" "}
                  {RELEASE_LABELS[manifest.releaseStatus]}
                </div>
                <div className="text-11 text-text-tertiary font-mono">
                  key: {manifest.moduleKey}
                </div>
                {hasAdminSettings && (
                  <Link
                    href={`/platform/settings/modules/${manifest.moduleKey}`}
                    className="text-12 text-text-subtle hover:text-text mt-1 inline-block font-medium underline"
                  >
                    Política global de {manifest.displayName}
                  </Link>
                )}
              </div>
              {canManage ? (
                <PlatformAvailabilityForm
                  moduleKey={manifest.moduleKey}
                  moduleName={manifest.displayName}
                  availability={availability}
                />
              ) : (
                <span className="text-12 text-text-subtle">{availability}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
