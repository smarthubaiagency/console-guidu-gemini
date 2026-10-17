import type { Metadata } from "next";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { Building2, ChevronRight, Plus, Store } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { ModuleNotice } from "@/components/modules/module-notice";
import { PageCanvas } from "@/components/patterns/page-canvas";
import { PageTitle } from "@/components/patterns/page-title";
import { ActionForm } from "@/components/partners/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { partnerGrants } from "@/core/module-runtime/loaders";
import { readServiceModes } from "@/core/organizations/service-mode";
import { createPartnerCustomerAction } from "@/core/partners/actions";
import { listWorkspaceTemplates } from "@/core/partners/customers";
import { listPartnerCustomers } from "@/core/partners/members";
import { listPartnerScheduledDeletions } from "@/core/privacy/deletion";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { AUTOMATION_AREAS } from "@/modules/google-business/areas";
import {
  AddLocationSlot,
  windowStepOf,
} from "@/modules/google-business/components/server-parts";
import {
  type GbAccess,
  gbModuleAvailable,
  partnerMayOperate,
  resolveAdminAccess,
} from "@/modules/google-business/server/access";
import {
  listLocations,
  type LocationSummary,
} from "@/modules/google-business/server/automation";
import {
  automationPath,
  windowPath,
} from "@/modules/google-business/server/target";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("partnerConsole");
  return { title: t("customers.metaTitle") };
}

const STATUS_KEYS = new Set(["active", "suspended", "inactive"]);

interface PageProps {
  searchParams: Promise<{
    workspace?: string;
    addLocation?: string;
    missing?: string;
  }>;
}

type ManagedWorkspace = Readonly<{
  id: string;
  organizationId: string;
  name: string;
  locations: readonly LocationSummary[];
}>;

/**
 * Companies of the partner (ADR 0012, P4a): registration data, the service
 * mode (ADR 0020) and, for the companies it manages, their workspaces with
 * the Google fichas and "Adicionar local" (GB1a). Companies in `padrao`
 * mode show only their registration data.
 */
export default async function PartnerCustomersPage({
  searchParams,
}: PageProps) {
  const { identity, partner, membership } =
    await requirePartnerConsolePage("/admin/customers");
  const grants = partnerGrants(membership.role);
  if (!grants("partner.customers.read")) {
    return <ModuleNotice variant="denied" />;
  }
  const canManage = grants("partner.customers.manage");
  const operatesFichas =
    gbModuleAvailable() && partnerMayOperate(membership.role);
  const query = await searchParams;

  const { customers, templates, modes, workspaces, deletions } =
    await withIdentityContext(
      prisma,
      identity.userId,
      async (tx) => {
        const customers = await listPartnerCustomers(tx, partner.partnerId);
        const modes = await readServiceModes(
          tx,
          customers.map((c) => c.id),
        );
        const managed = customers
          .filter((c) => modes.get(c.id) === "gerenciado")
          .map((c) => c.id);
        return {
          customers,
          modes,
          // Scheduled deletions of the companies' workspaces (WS1).
          deletions: await listPartnerScheduledDeletions(tx),
          templates: canManage
            ? await listWorkspaceTemplates(tx, partner.partnerId)
            : [],
          workspaces:
            operatesFichas && managed.length > 0
              ? await tx.workspace.findMany({
                  where: { organizationId: { in: managed }, status: "active" },
                  orderBy: { name: "asc" },
                  select: { id: true, organizationId: true, name: true },
                })
              : [],
        };
      },
      { partnerId: partner.partnerId },
    );

  const managedWorkspaces: ManagedWorkspace[] = await Promise.all(
    workspaces.map(async (workspace) => {
      const ctx = {
        userId: identity.userId,
        workspaceId: workspace.id,
        organizationId: workspace.organizationId,
        partnerId: partner.partnerId,
      };
      const locations = await withContext(prisma, ctx, (tx) =>
        listLocations(tx, ctx),
      ).catch(() => []);
      return { ...workspace, locations };
    }),
  );

  let windowAccess: GbAccess | null = null;
  const step = windowStepOf(query.addLocation);
  if (step && query.workspace && operatesFichas) {
    try {
      windowAccess = await resolveAdminAccess(
        {
          userId: identity.userId,
          partnerId: partner.partnerId,
          partnerRole: membership.role,
        },
        query.workspace,
      );
    } catch (error) {
      unstable_rethrow(error);
      windowAccess = null;
    }
  }

  const t = await getTranslations("partnerConsole");
  const tg = await getTranslations("googleBusiness");
  const format = await getFormatter();

  return (
    <PageCanvas>
      <PageTitle
        icon={<Building2 className="size-6" />}
        title={t("customers.title")}
        description={t("customers.description")}
      />
      {canManage ? (
        <Card variant="surface" className="px-4 sm:px-6">
          <CardHeader className="px-0">
            <CardTitle className="text-16">{t("customers.newTitle")}</CardTitle>
            <CardDescription>{t("customers.hint")}</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <ActionForm
              action={createPartnerCustomerAction}
              submitLabel={t("customers.submit")}
              className="grid gap-3 sm:grid-cols-2"
              testId="create-customer"
            >
              <Label className="flex-col items-start">
                {t("customers.company")}
                <Input name="organizationName" required maxLength={120} />
              </Label>
              <Label className="flex-col items-start">
                {t("customers.ownerEmail")}
                <Input name="ownerEmail" type="email" required />
              </Label>
              <Label className="flex-col items-start">
                {t("customers.workspaceName")}
                <Input name="workspaceName" required maxLength={80} />
              </Label>
              <Label className="flex-col items-start">
                {t("customers.workspaceSlug")}
                <Input
                  name="workspaceSlug"
                  required
                  pattern="[a-z0-9][a-z0-9-]{1,46}[a-z0-9]"
                  placeholder={t("customers.slugPlaceholder")}
                />
              </Label>
              <Label className="flex-col items-start">
                {t("customers.template")}
                <NativeSelect
                  name="templateId"
                  defaultValue=""
                  className="w-full"
                >
                  <NativeSelectOption value="">
                    {t("customers.noTemplate")}
                  </NativeSelectOption>
                  {templates.map((template) => (
                    <NativeSelectOption key={template.id} value={template.id}>
                      {template.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Label>
              <Label className="flex-col items-start">
                {t("customers.serviceMode")}
                <NativeSelect
                  name="serviceMode"
                  defaultValue="gerenciado"
                  className="w-full"
                >
                  <NativeSelectOption value="gerenciado">
                    {t("customers.modes.gerenciado")}
                  </NativeSelectOption>
                  <NativeSelectOption value="padrao">
                    {t("customers.modes.padrao")}
                  </NativeSelectOption>
                </NativeSelect>
              </Label>
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}

      <Card variant="panel" className="px-4 sm:px-6">
        <ItemGroup className="gap-2" data-testid="partner-customers">
          {customers.map((customer) => {
            const mode = modes.get(customer.id) ?? "padrao";
            const own = managedWorkspaces.filter(
              (w) => w.organizationId === customer.id,
            );
            return (
              <Item
                key={customer.id}
                variant="card"
                role="listitem"
                className="flex-wrap"
              >
                <ItemContent className="min-w-0">
                  <ItemTitle>{customer.name}</ItemTitle>
                  <ItemDescription>
                    {STATUS_KEYS.has(customer.status)
                      ? t(`customers.status.${customer.status}`)
                      : customer.status}{" "}
                    ·{" "}
                    {t("customers.since", {
                      date: format.dateTime(customer.createdAt, {
                        dateStyle: "short",
                      }),
                    })}
                  </ItemDescription>
                </ItemContent>
                <ItemActions className="flex-wrap">
                  {deletions
                    .filter((d) => d.organizationId === customer.id)
                    .map((deletion) => (
                      <Badge
                        key={deletion.workspaceId}
                        variant="danger"
                        title={t("customers.deletionScheduledTitle", {
                          workspace: deletion.workspaceName,
                        })}
                        data-testid="deletion-scheduled"
                      >
                        {t("customers.deletionScheduled", {
                          date: format.dateTime(deletion.purgeAfter, {
                            day: "2-digit",
                            month: "2-digit",
                            timeZone: "America/Sao_Paulo",
                          }),
                        })}
                      </Badge>
                    ))}
                  <Badge variant={mode === "gerenciado" ? "info" : "neutral"}>
                    {t(`customers.modes.${mode}`)}
                  </Badge>
                </ItemActions>
                {own.length > 0 ? (
                  <div
                    className="flex w-full flex-col gap-2"
                    data-testid="managed-workspaces"
                  >
                    {own.map((workspace) => {
                      const target = {
                        scope: "admin" as const,
                        workspaceId: workspace.id,
                      };
                      return (
                        <Card
                          key={workspace.id}
                          variant="inset"
                          className="gap-3 px-4"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-14 text-text min-w-0 flex-1 font-semibold">
                              {workspace.name}
                            </p>
                            <Button asChild size="sm" variant="outline">
                              <Link href={windowPath(target, "connect")}>
                                <Plus />
                                {tg("home.addLocation")}
                              </Link>
                            </Button>
                          </div>
                          {workspace.locations.length > 0 ? (
                            <ItemGroup className="gap-2">
                              {workspace.locations.map((location) => (
                                <Item
                                  key={location.id}
                                  variant="card"
                                  size="sm"
                                  asChild
                                >
                                  <Link
                                    href={automationPath(target, location.id)}
                                  >
                                    <ItemMedia>
                                      <Store className="text-text-secondary size-4" />
                                    </ItemMedia>
                                    <ItemContent className="min-w-0">
                                      <ItemTitle>{location.name}</ItemTitle>
                                    </ItemContent>
                                    <ItemActions>
                                      <Badge
                                        variant={
                                          location.reviewed
                                            ? "success"
                                            : "warning"
                                        }
                                      >
                                        {tg("home.configured", {
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
                          ) : (
                            <p className="text-12 text-text-secondary">
                              {tg("home.emptyTitle")}
                            </p>
                          )}
                        </Card>
                      );
                    })}
                  </div>
                ) : null}
              </Item>
            );
          })}
          {customers.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t("customers.empty")}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : null}
        </ItemGroup>
      </Card>

      {windowAccess ? (
        <AddLocationSlot
          access={windowAccess}
          step={step}
          missing={query.missing}
          closeHref="/admin/customers"
        />
      ) : null}
    </PageCanvas>
  );
}
