import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { sectionClass } from "@/components/billing/billing-ui";
import { LocationFields } from "@/components/locations/location-fields";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { ActionForm } from "@/components/partners/action-form";
import { requireUserPage } from "@/core/auth/page-guard";
import { updateLocationAction } from "@/core/locations/actions";
import { getLocation } from "@/core/locations/service";
import { workspaceGrants } from "@/core/module-runtime/loaders";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { getEffectiveWorkspaceRole } from "@/core/permissions/guard";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";

export async function generateMetadata() {
  const t = await getTranslations("locations");
  return { title: t("detailMetaTitle") };
}

interface PageProps {
  params: Promise<{ workspaceSlug: string; locationId: string }>;
}

export default async function LocationPage({ params }: PageProps) {
  const { workspaceSlug, locationId } = await params;
  const identity = await requireUserPage(
    `/app/${workspaceSlug}/settings/locations/${locationId}`,
  );
  const context = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );
  const view = await withContext(prisma, context, async (tx) => {
    try {
      return {
        location: await getLocation(tx, context, locationId),
        canManage: workspaceGrants(
          await getEffectiveWorkspaceRole(tx, context),
        )("workspace.locations.manage"),
      };
    } catch {
      return null;
    }
  });
  if (!view) notFound();
  const { location, canManage } = view;
  const t = await getTranslations("locations");

  return (
    <div className="mx-auto max-w-4xl space-y-6" data-testid="location">
      <ModulePageHeader
        title={location.name}
        description={
          location.status === "inactive"
            ? t("inactiveDescription")
            : t("detailDescription")
        }
        icon={<MapPin className="h-5 w-5" />}
      />
      <section className={sectionClass}>
        {canManage ? (
          <ActionForm
            action={updateLocationAction}
            submitLabel={t("save")}
            className="space-y-3"
            testId="edit-location"
          >
            <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
            <input type="hidden" name="locationId" value={location.id} />
            <LocationFields location={location} />
          </ActionForm>
        ) : (
          <fieldset disabled>
            <LocationFields location={location} />
          </fieldset>
        )}
      </section>
      {canManage ? (
        <section className={sectionClass}>
          <ActionForm
            action={updateLocationAction}
            submitLabel={
              location.status === "active" ? t("deactivate") : t("reactivate")
            }
            tone="neutral"
            testId="toggle-location"
          >
            <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
            <input type="hidden" name="locationId" value={location.id} />
            <input
              type="hidden"
              name="status"
              value={location.status === "active" ? "inactive" : "active"}
            />
          </ActionForm>
        </section>
      ) : null}
    </div>
  );
}
