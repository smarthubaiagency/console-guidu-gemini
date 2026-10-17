import type { Metadata } from "next";
import { Building2 } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { PageCanvas } from "@/components/patterns/page-canvas";
import { PageTitle } from "@/components/patterns/page-title";
import { ActionForm } from "@/components/partners/action-form";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getPlatformAdminMember,
  listAdminOrganizations,
} from "@/core/admin/platform";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { isSubscriptionStatus } from "@/core/billing/subscriptions";
import { platformGrants } from "@/core/module-runtime/loaders";
import {
  cancelManagedModePlatformAction,
  requestManagedModePlatformAction,
} from "@/core/service-modes/actions";
import { platformServiceModes } from "@/core/service-modes/service";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("platform.customers");
  return { title: t("metaTitle") };
}

const STATUS_VARIANT: Record<string, "success" | "warning" | "neutral"> = {
  active: "success",
  suspended: "warning",
};

const SITUATION_VARIANT = {
  pending: "warning",
  approved: "success",
  denied: "danger",
  expired: "neutral",
  cancelled: "neutral",
} as const;

/**
 * Customer companies of the platform (F4e) with the service mode of
 * GUIDU's direct customers (partner zero, GB1c): "Pedir gerenciamento"
 * sends the secure link to the company owner.
 */
export default async function AdminCustomersPage() {
  const identity = await requirePlatformAdminPage("/platform/customers");
  const organizations = await listAdminOrganizations(prisma, identity.userId);
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  const grants = platformGrants(admin?.status === "active" ? admin.role : null);
  // Plan column (F3b): subscriptions are readable by billing roles only.
  const canReadBilling = grants("platform.billing.read");
  const canRequestMode = grants("platform.service_mode.request");
  const { plans, modes } = await withIdentityContext(
    prisma,
    identity.userId,
    async (tx) => ({
      plans: canReadBilling
        ? await tx.subscription.findMany({
            where: { status: { not: "canceled" } },
            select: {
              organizationId: true,
              status: true,
              planVersion: { select: { plan: { select: { name: true } } } },
            },
          })
        : [],
      modes: await platformServiceModes(tx),
    }),
  );
  const planByOrg = new Map(plans.map((p) => [p.organizationId, p]));
  const t = await getTranslations("platform.customers");
  const ts = await getTranslations("serviceMode");
  const tUsage = await getTranslations("usage");
  const format = await getFormatter();

  return (
    <PageCanvas>
      <PageTitle
        icon={<Building2 className="size-6" />}
        title={t("title")}
        description={t("description")}
      />
      <Card variant="panel" className="gap-3 px-4 sm:px-6">
        <p className="text-12 text-text-subtle font-semibold">
          {t("total", { count: organizations.length })}
        </p>
        <div className="overflow-x-auto">
          <Table
            variant="soft"
            className="text-12"
            data-testid="platform-customers"
          >
            <TableHeader>
              <TableRow>
                <TableHead>{t("colOrganization")}</TableHead>
                <TableHead>{t("colMaxSeats")}</TableHead>
                <TableHead>{t("colPlan")}</TableHead>
                <TableHead>{ts("console.column")}</TableHead>
                <TableHead>{t("colStatus")}</TableHead>
                <TableHead>{t("colCreatedAt")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {organizations.map((org) => {
                const direct = modes.get(org.id);
                const request = direct?.request ?? null;
                return (
                  <TableRow key={org.id}>
                    <TableCell>
                      <div className="text-text font-semibold">{org.name}</div>
                      <div className="text-11 text-text-tertiary font-mono">
                        {org.id}
                      </div>
                    </TableCell>
                    <TableCell className="text-text-subtle font-medium">
                      {t("seats", { count: org.maxSeats })}
                    </TableCell>
                    <TableCell className="text-text-subtle">
                      {!canReadBilling
                        ? "—"
                        : (() => {
                            const plan = planByOrg.get(org.id);
                            if (!plan) return t("legacyPlan");
                            return `${plan.planVersion.plan.name} · ${
                              isSubscriptionStatus(plan.status)
                                ? tUsage(`subscriptionStatus.${plan.status}`)
                                : plan.status
                            }`;
                          })()}
                    </TableCell>
                    <TableCell>
                      {direct ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={
                              direct.mode === "gerenciado" ? "info" : "neutral"
                            }
                          >
                            {ts(`modes.${direct.mode}`)}
                          </Badge>
                          {request && direct.mode === "padrao" ? (
                            <Badge
                              variant={SITUATION_VARIANT[request.situation]}
                            >
                              {request.situation === "pending"
                                ? ts("console.pendingUntil", {
                                    date: format.dateTime(request.expiresAt, {
                                      dateStyle: "short",
                                    }),
                                  })
                                : ts(`situation.${request.situation}`)}
                            </Badge>
                          ) : null}
                          {canRequestMode && direct.mode === "padrao" ? (
                            request?.situation === "pending" ? (
                              <ActionForm
                                action={cancelManagedModePlatformAction}
                                submitLabel={ts("console.cancel")}
                                tone="neutral"
                              >
                                <input
                                  type="hidden"
                                  name="requestId"
                                  value={request.id}
                                />
                              </ActionForm>
                            ) : (
                              <ActionForm
                                action={requestManagedModePlatformAction}
                                submitLabel={ts("console.request")}
                                tone="neutral"
                              >
                                <input
                                  type="hidden"
                                  name="organizationId"
                                  value={org.id}
                                />
                              </ActionForm>
                            )
                          ) : null}
                        </div>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[org.status] ?? "neutral"}>
                        {org.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-text-secondary">
                      {format.dateTime(org.createdAt, { dateStyle: "short" })}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>
    </PageCanvas>
  );
}
