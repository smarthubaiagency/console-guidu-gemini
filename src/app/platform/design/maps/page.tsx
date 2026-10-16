import { MapPinned } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ModuleNotice } from "@/components/modules/module-notice";
import { PageCanvas } from "@/components/patterns/page-canvas";
import { PageTitle } from "@/components/patterns/page-title";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { platformGrants } from "@/core/module-runtime/loaders";
import { prisma } from "@/lib/prisma/client";
import { MapsHealthPanel } from "@/modules/google-business/components/maps/maps-health-panel";
import { buildDemoMapsView } from "@/modules/google-business/components/maps/demo-data";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("gbIntelligence.maps");
  return { title: t("demoTitle") };
}

/**
 * Plataforma › Padrões de interface › Saúde no Maps (GB1b): the maps
 * component of the agent GMN with a sample measurement computed by the
 * fake provider and the real formulas. Nothing here reads or writes data;
 * the automation page (GB1a) plugs the same component with
 * `loadMapsHealthView`.
 */
export default async function MapsDesignPage() {
  const identity = await requirePlatformAdminPage("/platform/design/maps");
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  const role = admin?.status === "active" ? admin.role : null;
  if (!platformGrants(role)("platform.modules.read")) {
    return <ModuleNotice variant="denied" />;
  }
  const t = await getTranslations("gbIntelligence.maps");
  const view = await buildDemoMapsView();
  return (
    <PageCanvas>
      <PageTitle
        icon={<MapPinned className="size-6" />}
        title={t("demoTitle")}
        description={t("demoSubtitle")}
      />
      <MapsHealthPanel view={view} />
    </PageCanvas>
  );
}
