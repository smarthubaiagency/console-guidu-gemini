import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Puzzle } from "lucide-react";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { platformGrants } from "@/core/module-runtime/loaders";
import { getPlatformModuleConfig } from "@/core/module-runtime/settings";
import type { PermissionKey } from "@/core/permissions/catalog";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { getRegisteredModule } from "@/modules/registry";
import {
  hasSettingsComponent,
  renderSettingsComponent,
} from "@/modules/settings-components";

export const metadata: Metadata = {
  title: "Configurações Globais do Módulo (Admin)",
};

interface PageProps {
  params: Promise<{ moduleKey: string }>;
}

/**
 * Shared admin Settings host (ADR 0005, Adendo §8.2). Global settings remain
 * reachable during maintenance or when the module is disabled for customers.
 */
export default async function AdminModuleSettingsPage({ params }: PageProps) {
  const { moduleKey } = await params;
  const identity = await requirePlatformAdminPage(
    `/admin/settings/modules/${moduleKey}`,
  );

  const mod = getRegisteredModule(moduleKey);
  const entry = mod?.manifest.settings.find((s) => s.destination === "admin");
  if (
    !mod ||
    !mod.technicalGate() ||
    !entry ||
    !hasSettingsComponent(entry.componentKey)
  )
    notFound();

  const admin = await getPlatformAdminMember(prisma, identity.userId);
  const grants = platformGrants(admin?.role ?? null);
  const canRead = entry.readPermissions.every((p) =>
    grants(p as PermissionKey),
  );
  const canWrite = entry.writePermissions.every((p) =>
    grants(p as PermissionKey),
  );

  const config = canRead
    ? await withIdentityContext(prisma, identity.userId, (tx) =>
        getPlatformModuleConfig(tx, moduleKey),
      )
    : {};

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <ModulePageHeader
        trail={[
          "Administração",
          "Configurações de módulos",
          mod.manifest.displayName,
        ]}
        title={`${entry.label} — política global`}
        description={mod.manifest.description}
        icon={<Puzzle className="h-5 w-5" />}
      />
      {canRead ? (
        renderSettingsComponent(entry.componentKey, {
          moduleKey,
          destination: "admin",
          workspaceSlug: null,
          canWrite,
          config,
          inherited: {},
        })
      ) : (
        <ModuleNotice variant="denied" />
      )}
    </div>
  );
}
