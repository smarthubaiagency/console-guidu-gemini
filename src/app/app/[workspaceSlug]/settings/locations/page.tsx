import type { Metadata } from "next";
import Link from "next/link";
import { MapPin } from "lucide-react";

import { sectionClass } from "@/components/billing/billing-ui";
import { LocationFields } from "@/components/locations/location-fields";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { ActionForm } from "@/components/partners/action-form";
import { requireUserPage } from "@/core/auth/page-guard";
import { createLocationAction } from "@/core/locations/actions";
import { listLocations } from "@/core/locations/service";
import { workspaceGrants } from "@/core/module-runtime/loaders";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { getEffectiveWorkspaceRole } from "@/core/permissions/guard";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";

export const metadata: Metadata = { title: "Lojas" };

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

/**
 * Stores and properties of the business (F5a, UCP Location). Used by the
 * Portfolio (pickup, service on site, events), Google Business and the
 * agent (opening hours). Members see; owner and admin manage.
 */
export default async function LocationsPage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const identity = await requireUserPage(
    `/app/${workspaceSlug}/settings/locations`,
  );
  const context = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );
  const { locations, canManage } = await withContext(
    prisma,
    context,
    async (tx) => ({
      locations: await listLocations(tx, context, { includeInactive: true }),
      canManage: workspaceGrants(await getEffectiveWorkspaceRole(tx, context))(
        "workspace.locations.manage",
      ),
    }),
  );
  const base = `/app/${workspaceSlug}/settings/locations`;

  return (
    <div className="mx-auto max-w-4xl space-y-6" data-testid="locations">
      <ModulePageHeader
        trail={["Configurações", "Lojas"]}
        title="Lojas"
        description="Lojas e endereços de atendimento do negócio, com horários. O Portfólio, o Google e o agente usam estes dados."
        icon={<MapPin className="h-5 w-5" />}
      />
      <section className={sectionClass}>
        <h2 className="text-14 text-text font-semibold">
          Lojas ({locations.length})
        </h2>
        <ul className="divide-border divide-y" data-testid="location-list">
          {locations.map((l) => (
            <li
              key={l.id}
              className="flex flex-wrap items-center justify-between gap-2 py-3"
            >
              <Link
                href={`${base}/${l.id}`}
                className="text-14 text-text font-medium hover:underline"
              >
                {l.name}
              </Link>
              <span className="text-12 text-text-secondary">
                {[l.address.address_locality, l.address.address_region]
                  .filter(Boolean)
                  .join(" / ")}
                {l.status === "inactive" ? " · desativada" : ""}
              </span>
            </li>
          ))}
          {locations.length === 0 ? (
            <li className="text-12 text-text-secondary py-2">
              Nenhuma loja ainda.
            </li>
          ) : null}
        </ul>
      </section>
      {canManage ? (
        <section className={sectionClass}>
          <h2 className="text-14 text-text font-semibold">Nova loja</h2>
          <ActionForm
            action={createLocationAction}
            submitLabel="Cadastrar loja"
            className="space-y-3"
            testId="create-location"
          >
            <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
            <LocationFields />
          </ActionForm>
        </section>
      ) : null}
    </div>
  );
}
