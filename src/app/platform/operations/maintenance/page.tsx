import type { Metadata } from "next";
import { Activity } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { MaintenanceSettings } from "@/components/maintenance/maintenance-settings";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { OperationsTabs } from "@/components/operations/operations-tabs";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import {
  endMaintenanceAction,
  saveMaintenanceAction,
} from "@/core/maintenance/actions";
import { maintenanceView } from "@/core/maintenance/service";
import { platformGrants } from "@/core/module-runtime/loaders";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("maintenance");
  return { title: t("metaTitle") };
}

/**
 * Operações › Manutenção (CF5c): the maintenance or read-only window of the
 * whole platform, scheduled, with the notice to the users. Operações'
 * readers see it; owner and operations change it.
 */
export default async function PlatformMaintenancePage() {
  const identity = await requirePlatformAdminPage(
    "/platform/operations/maintenance",
  );
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  const role = admin?.status === "active" ? admin.role : null;
  if (!platformGrants(role)("platform.operations.read")) {
    return <ModuleNotice variant="denied" />;
  }
  const view = await withIdentityContext(prisma, identity.userId, (tx) =>
    maintenanceView(tx, { userId: identity.userId, platformRole: role }),
  );
  const t = await getTranslations("operations");
  const tm = await getTranslations("maintenance");

  return (
    <div
      className="mx-auto max-w-5xl space-y-6"
      data-testid="platform-maintenance"
    >
      <ModulePageHeader
        title={t("title")}
        description={tm("description")}
        icon={<Activity className="h-5 w-5" />}
      />
      <OperationsTabs active="maintenance" />
      <MaintenanceSettings
        view={view}
        saveAction={saveMaintenanceAction}
        endAction={endMaintenanceAction}
      />
    </div>
  );
}
