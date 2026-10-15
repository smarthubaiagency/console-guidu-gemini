import type { Metadata } from "next";
import { Activity } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { SecurityEvents } from "@/components/security/security-events";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { partnerGrants } from "@/core/module-runtime/loaders";
import { listSecurityEvents, parseBefore } from "@/core/security/events";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export const metadata: Metadata = { title: "Eventos de segurança (Admin)" };

const PATH = "/admin/settings/security/events";

/**
 * Admin › Configurações › Eventos de segurança (CF5a), read only: the
 * partner's own events and those of its customers' companies.
 */
export default async function PartnerSecurityEventsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const { identity, partner, membership } =
    await requirePartnerConsolePage(PATH);
  if (!partnerGrants(membership.role)("partner.security.read")) {
    return <ModuleNotice variant="denied" />;
  }
  const before = parseBefore((await searchParams).before);
  const page = await withIdentityContext(
    prisma,
    identity.userId,
    (tx) => listSecurityEvents(tx, { before }),
    { partnerId: partner.partnerId },
  );
  const t = await getTranslations("security");

  return (
    <>
      <ModulePageHeader
        title={t("events.title")}
        description={t("events.description.partner")}
        icon={<Activity className="h-5 w-5" />}
      />
      <SecurityEvents
        page={page}
        level="partner"
        viewerId={identity.userId}
        basePath={PATH}
        paged={before !== null}
      />
    </>
  );
}
