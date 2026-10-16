import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { PlatformAudit } from "@/components/audit/platform-audit";
import { ModuleNotice } from "@/components/modules/module-notice";
import { getPlatformAdminMember } from "@/core/admin/platform";
import {
  parseAuditCursor,
  parseAuditFilters,
} from "@/core/audit/platform-filters";
import {
  listPlatformAuditEvents,
  loadAuditFilterOptions,
} from "@/core/audit/platform-read";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { platformGrants } from "@/core/module-runtime/loaders";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

const PATH = "/platform/audit";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("platformAudit");
  return { title: t("title") };
}

/**
 * Plataforma › Auditoria (AUD1), read only: the whole audit trail with
 * filters, a cursor and the detail of each event in the internal drawer.
 * The permission is checked here and again in the service; the database
 * narrows the billing role to the billing actions.
 */
export default async function PlatformAuditPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const identity = await requirePlatformAdminPage(PATH);
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  const role = admin?.status === "active" ? admin.role : null;
  const grants = platformGrants(role);
  if (!grants("platform.audit.read")) {
    return <ModuleNotice variant="denied" />;
  }

  const params = await searchParams;
  const filters = parseAuditFilters(params);
  const cursor = parseAuditCursor(params.before);
  const { page, options } = await withIdentityContext(
    prisma,
    identity.userId,
    async (tx) => ({
      page: await listPlatformAuditEvents(tx, role, { filters, cursor }),
      options: await loadAuditFilterOptions(tx, role),
    }),
  );
  const event = typeof params.event === "string" ? params.event : null;

  return (
    <PlatformAudit
      page={page}
      options={options}
      filters={filters}
      paged={cursor !== null}
      billingOnly={role === "billing"}
      securityLinks={grants("platform.security.read")}
      initialEventId={event}
    />
  );
}
