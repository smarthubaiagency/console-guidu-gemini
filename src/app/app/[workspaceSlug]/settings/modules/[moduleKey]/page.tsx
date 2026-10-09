import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Puzzle } from "lucide-react";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { resolveWorkspaceContext } from "@/core/auth/context";
import { requireUserPage } from "@/core/auth/page-guard";
import { workspaceGrants } from "@/core/module-runtime/loaders";
import {
  getPlatformModuleConfig,
  getWorkspaceModuleConfig,
} from "@/core/module-runtime/settings";
import { getModuleAccessState } from "@/core/module-runtime/state";
import type { PermissionKey } from "@/core/permissions/catalog";
import { getEffectiveWorkspaceRole } from "@/core/permissions/guard";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { getRegisteredModule } from "@/modules/registry";
import {
  hasSettingsComponent,
  renderSettingsComponent,
} from "@/modules/settings-components";

export const metadata: Metadata = { title: "Configurações do Módulo" };

interface PageProps {
  params: Promise<{ workspaceSlug: string; moduleKey: string }>;
}

/**
 * Shared workspace Settings host (ADR 0005, Adendo §8.2). Resolves context,
 * module state and permissions on the server before loading configuration;
 * the navigation filter is not the protection of this route.
 */
export default async function WorkspaceModuleSettingsPage({
  params,
}: PageProps) {
  const { workspaceSlug, moduleKey } = await params;
  const identity = await requireUserPage(
    `/app/${workspaceSlug}/settings/modules/${moduleKey}`,
  );

  const mod = getRegisteredModule(moduleKey);
  const entry = mod?.manifest.settings.find(
    (s) => s.destination === "workspace",
  );
  if (!mod || !entry || !hasSettingsComponent(entry.componentKey)) notFound();

  let context;
  try {
    context = await resolveWorkspaceContext(
      prisma,
      identity.userId,
      workspaceSlug,
    );
  } catch {
    notFound();
  }

  const view = await withContext(prisma, context, async (tx) => {
    const [state, role] = await Promise.all([
      getModuleAccessState(tx, context, moduleKey),
      getEffectiveWorkspaceRole(tx, context),
    ]);
    const grants = workspaceGrants(role);
    const canRead = entry.readPermissions.every((p) =>
      grants(p as PermissionKey),
    );
    const canWrite = entry.writePermissions.every((p) =>
      grants(p as PermissionKey),
    );
    if (state === "hidden" || state === "coming_soon")
      return { kind: "missing" as const };
    if (!canRead) return { kind: "denied" as const };
    if (state !== "enabled") return { kind: state };
    const [config, inherited] = await Promise.all([
      getWorkspaceModuleConfig(tx, context, moduleKey),
      getPlatformModuleConfig(tx, moduleKey),
    ]);
    return { kind: "ready" as const, canWrite, config, inherited };
  });

  if (view.kind === "missing") notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <ModulePageHeader
        trail={["Configurações", "Módulos", mod.manifest.displayName]}
        title={entry.label}
        description={mod.manifest.description}
        icon={<Puzzle className="h-5 w-5" />}
      />
      {view.kind === "ready" ? (
        renderSettingsComponent(entry.componentKey, {
          moduleKey,
          destination: "workspace",
          workspaceSlug,
          canWrite: view.canWrite,
          config: view.config,
          inherited: view.inherited,
        })
      ) : (
        <ModuleNotice variant={view.kind} />
      )}
    </div>
  );
}
