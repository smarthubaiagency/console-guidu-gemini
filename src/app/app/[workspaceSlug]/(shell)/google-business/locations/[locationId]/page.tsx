import type { Metadata } from "next";
import { notFound, unstable_rethrow } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { requireUserPage } from "@/core/auth/page-guard";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import { AppError } from "@/shared/errors";
import { isAutomationArea } from "@/modules/google-business/areas";
import { AutomationPage } from "@/modules/google-business/components/automation-page";
import { automationPageData } from "@/modules/google-business/components/server-parts";
import { resolveAppAccess } from "@/modules/google-business/server/access";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("googleBusiness");
  return { title: t("automation.metaTitle") };
}

interface PageProps {
  params: Promise<{ workspaceSlug: string; locationId: string }>;
  searchParams: Promise<{ area?: string }>;
}

/** Automation page of a ficha in the `/app` (GB1a). */
export default async function GoogleBusinessLocationPage({
  params,
  searchParams,
}: PageProps) {
  const { workspaceSlug, locationId } = await params;
  const { area } = await searchParams;
  const identity = await requireUserPage(
    `/app/${workspaceSlug}/google-business/locations/${locationId}`,
  );
  let rendered: {
    access: Awaited<ReturnType<typeof resolveAppAccess>>;
    data: Awaited<ReturnType<typeof automationPageData>>;
  };
  try {
    // The workspace first (F6a guard), then the module's access.
    await resolveRequestWorkspaceContext(prisma, identity.userId, workspaceSlug);
    const access = await resolveAppAccess(identity.userId, workspaceSlug);
    const data = await automationPageData(access, locationId);
    rendered = { access, data };
  } catch (error) {
    unstable_rethrow(error);
    if (
      error instanceof AppError &&
      (error.code === "not_found" || error.code === "forbidden")
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
