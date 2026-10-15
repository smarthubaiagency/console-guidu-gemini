import type { Metadata } from "next";
import { Activity } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { SecurityEvents } from "@/components/security/security-events";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { platformGrants } from "@/core/module-runtime/loaders";
import { listSecurityEvents, parseBefore } from "@/core/security/events";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export const metadata: Metadata = {
  title: "Eventos de segurança (Plataforma)",
};

const PATH = "/platform/settings/security/events";

/** Plataforma › Configurações › Eventos de segurança (CF5a), read only. */
export default async function PlatformSecurityEventsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const identity = await requirePlatformAdminPage(PATH);
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  if (!platformGrants(admin?.role ?? null)("platform.security.read")) {
    return <ModuleNotice variant="denied" />;
  }
  const before = parseBefore((await searchParams).before);
  const page = await withIdentityContext(prisma, identity.userId, (tx) =>
    listSecurityEvents(tx, { before }),
  );
  const t = await getTranslations("security");

  return (
    <>
      <ModulePageHeader
        title={t("events.title")}
        description={t("events.description.platform")}
        icon={<Activity className="h-5 w-5" />}
      />
      <SecurityEvents
        page={page}
        level="platform"
        viewerId={identity.userId}
        basePath={PATH}
        paged={before !== null}
      />
    </>
  );
}
