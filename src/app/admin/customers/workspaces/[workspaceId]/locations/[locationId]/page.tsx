import type { Metadata } from "next";
import { notFound, unstable_rethrow } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { AppError } from "@/shared/errors";
import { isAutomationArea } from "@/modules/google-business/areas";
import { AutomationPage } from "@/modules/google-business/components/automation-page";
import { automationPageData } from "@/modules/google-business/components/server-parts";
import { resolveAdminAccess } from "@/modules/google-business/server/access";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("googleBusiness");
  return { title: t("automation.metaTitle") };
}

interface PageProps {
  params: Promise<{ workspaceId: string; locationId: string }>;
  searchParams: Promise<{ area?: string }>;
}

/**
 * Automation page of a ficha in the partner console (GB1a): only for the
 * team of the partner that manages the company (ADR 0020).
 */
export default async function PartnerLocationPage({
  params,
  searchParams,
}: PageProps) {
  const { workspaceId, locationId } = await params;
  const { area } = await searchParams;
  const { identity, partner, membership } = await requirePartnerConsolePage(
    `/admin/customers/workspaces/${workspaceId}/locations/${locationId}`,
  );
  let rendered: {
    access: Awaited<ReturnType<typeof resolveAdminAccess>>;
    data: Awaited<ReturnType<typeof automationPageData>>;
  };
  try {
    const access = await resolveAdminAccess(
      {
        userId: identity.userId,
        partnerId: partner.partnerId,
        partnerRole: membership.role,
      },
      workspaceId,
    );
    const data = await automationPageData(access, locationId);
    rendered = { access, data };
  } catch (error) {
    unstable_rethrow(error);
    if (
      error instanceof AppError &&
      (error.code === "not_found" ||
        error.code === "forbidden" ||
        error.code === "invalid_input")
    ) {
      notFound();
    }
    throw error;
  }
  return (
    <AutomationPage
      target={rendered.access.target}
      data={rendered.data}
      initialArea={area && isAutomationArea(area) ? area : null}
    />
  );
}
