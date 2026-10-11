import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";

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

export const metadata: Metadata = { title: "Loja" };

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

  return (
    <div className="mx-auto max-w-4xl space-y-6" data-testid="location">
      <ModulePageHeader
        trail={["Configurações", "Lojas", location.name]}
        title={location.name}
        description={
          location.status === "inactive"
            ? "Loja desativada: não aparece no Portfólio nem para o agente."
            : "Dados da loja no formato do protocolo UCP."
        }
        icon={<MapPin className="h-5 w-5" />}
      />
      <section className={sectionClass}>
        {canManage ? (
          <ActionForm
            action={updateLocationAction}
            submitLabel="Salvar loja"
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
              location.status === "active" ? "Desativar loja" : "Reativar loja"
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
