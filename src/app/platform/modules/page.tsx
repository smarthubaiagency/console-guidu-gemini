import type { Metadata } from "next";
import Link from "next/link";
import { Puzzle } from "lucide-react";
import { getTranslations } from "next-intl/server";

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
import { getModuleCatalog } from "@/core/i18n/modules";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("modules.platform");
  return { title: t("metaTitle") };
}

/** Availability, beta, maintenance and rollout of modules (ADR 0005). */
export default async function AdminModulesPage() {
  const identity = await requirePlatformAdminPage("/platform/modules");
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  const grants = platformGrants(admin?.role ?? null);

  if (!grants("platform.modules.read")) {
    return <ModuleNotice variant="denied" />;
  }
  const canManage = grants("platform.modules.manage");
  const t = await getTranslations("modules");
  const tPlatform = await getTranslations("platform");
  const catalog = await getModuleCatalog();

  const states = await withIdentityContext(prisma, identity.userId, (tx) =>
    loadPlatformModuleStates(tx),
  );
  const modules = listRegisteredModules().filter((m) => m.technicalGate());

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <ModulePageHeader
        trail={[tPlatform("breadcrumb"), t("platform.breadcrumb")]}
        title={t("platform.title")}
        description={t("platform.description")}
        icon={<Puzzle className="h-5 w-5" />}
      />
      <ul className="border-card-border bg-surface-card divide-border divide-y rounded-xl border shadow-xs">
        {modules.map(({ manifest }) => {
          const availability =
            states.get(manifest.moduleKey)?.availability ?? "enabled";
          const name = catalog.name(manifest.moduleKey, manifest.displayName);
          const hasAdminSettings = manifest.settings.some(
            (s) => s.destination === "admin",
          );
          return (
            <li
              key={manifest.moduleKey}
              className="flex items-center justify-between gap-4 p-4"
            >
              <div>
                <div className="text-14 text-text font-semibold">{name}</div>
                <div className="text-12 text-text-secondary">
                  {t("platform.versionLine", {
                    version: manifest.moduleVersion,
                    contract: manifest.contractVersion,
                    release: t(`release.${manifest.releaseStatus}`),
                  })}
                </div>
                <div className="text-11 text-text-tertiary font-mono">
                  {t("platform.key", { key: manifest.moduleKey })}
                </div>
                {hasAdminSettings && (
                  <Link
                    href={`/platform/settings/modules/${manifest.moduleKey}`}
                    className="text-12 text-text-subtle hover:text-text mt-1 inline-block font-medium underline"
                  >
                    {t("platform.globalPolicy", {
                      name,
                    })}
                  </Link>
                )}
              </div>
              {canManage ? (
                <PlatformAvailabilityForm
                  moduleKey={manifest.moduleKey}
                  moduleName={name}
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
