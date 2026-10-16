import type { Metadata } from "next";
import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChevronRight, Plus, Store } from "lucide-react";

import { ModuleNotice } from "@/components/modules/module-notice";
import { PageCanvas } from "@/components/patterns/page-canvas";
import { PageTitle } from "@/components/patterns/page-title";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { requireUserPage } from "@/core/auth/page-guard";
import { resolveModulePageAccess } from "@/core/module-runtime/page-access";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { AUTOMATION_AREAS } from "@/modules/google-business/areas";
import {
  AddLocationSlot,
  windowStepOf,
} from "@/modules/google-business/components/server-parts";
import { GoogleBusinessPermissions } from "@/modules/google-business/manifest";
import {
  gbModuleAvailable,
  resolveAppAccess,
} from "@/modules/google-business/server/access";
import { listLocations } from "@/modules/google-business/server/automation";
import {
  automationPath,
  onboardingPath,
  windowPath,
} from "@/modules/google-business/server/target";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("googleBusiness");
  return { title: t("metaTitle") };
}

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ addLocation?: string; missing?: string }>;
}

/**
 * Google Meu Negócio of the workspace (GB1a): the fichas, each linked to a
 * unit, and "Adicionar local", which opens the onboarding window (owner and
 * admin, in `padrao` mode). The page checks the workspace, the module and
 * the permission on the server.
 */
export default async function GoogleBusinessPage({
  params,
  searchParams,
}: PageProps) {
  const { workspaceSlug } = await params;
  const { addLocation, missing } = await searchParams;
  const identity = await requireUserPage(
    `/app/${workspaceSlug}/google-business`,
  );
  let context;
  try {
    context = await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      workspaceSlug,
    );
  } catch (error) {
    unstable_rethrow(error);
    notFound();
  }
  if (!gbModuleAvailable()) return <ModuleNotice variant="unavailable" />;
  const pageAccess = await withContext(prisma, context, (tx) =>
    resolveModulePageAccess(
      tx,
      context,
      "google-business",
      GoogleBusinessPermissions.READ,
    ),
  );
  if (pageAccess.kind === "missing") notFound();
  if (pageAccess.kind !== "ok")
    return <ModuleNotice variant={pageAccess.kind} />;

  const access = await resolveAppAccess(identity.userId, workspaceSlug);
  const locations = await withContext(prisma, access.ctx, (tx) =>
    listLocations(tx, access.ctx),
  );
  const t = await getTranslations("googleBusiness");
  const target = access.target;

  return (
    <PageCanvas>
      <PageTitle
        icon={<Store className="size-6" />}
        title={t("title")}
        description={t("home.description")}
        actions={
          access.canManage ? (
            <Button asChild>
              <Link href={windowPath(target, "connect")}>
                <Plus />
                {t("home.addLocation")}
              </Link>
            </Button>
          ) : null
        }
      />

      {access.mode === "gerenciado" ? (
        <Card variant="inset" className="px-4">
          <p className="text-14 text-text-secondary">{t("home.managed")}</p>
        </Card>
      ) : null}

      <Card variant="panel" className="px-4 sm:px-6">
        {locations.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Store />
              </EmptyMedia>
              <EmptyTitle>{t("home.emptyTitle")}</EmptyTitle>
              <EmptyDescription>{t("home.emptyDescription")}</EmptyDescription>
            </EmptyHeader>
            {access.canManage ? (
              <EmptyContent>
                <Button asChild variant="outline">
                  <Link href={windowPath(target, "connect")}>
                    <Plus />
                    {t("home.addLocation")}
                  </Link>
                </Button>
              </EmptyContent>
            ) : null}
          </Empty>
        ) : (
          <ItemGroup className="gap-2" data-testid="gb-locations">
            {locations.map((location) => (
              <Item key={location.id} variant="card" asChild>
                <Link href={automationPath(target, location.id)}>
                  <ItemMedia>
                    <Store className="text-text-secondary size-5" />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle>{location.name}</ItemTitle>
                    <ItemDescription>
                      {location.unitName ?? t("home.noUnit")}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Badge variant={location.reviewed ? "success" : "warning"}>
                      {t("home.configured", {
                        count: location.configured,
                        total: AUTOMATION_AREAS.length,
                      })}
                    </Badge>
                    <ChevronRight className="text-text-secondary size-4" />
                  </ItemActions>
                </Link>
              </Item>
            ))}
          </ItemGroup>
        )}
      </Card>

      <AddLocationSlot
        access={access}
        step={windowStepOf(addLocation)}
        missing={missing}
        closeHref={onboardingPath(target)}
      />
    </PageCanvas>
  );
}
