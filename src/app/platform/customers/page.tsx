import type { Metadata } from "next";
import { Building2 } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { prisma } from "@/lib/prisma/client";
import {
  getPlatformAdminMember,
  listAdminOrganizations,
} from "@/core/admin/platform";
import { isSubscriptionStatus } from "@/core/billing/subscriptions";
import { platformGrants } from "@/core/module-runtime/loaders";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("platform.customers");
  return { title: t("metaTitle") };
}

export default async function AdminCustomersPage() {
  const identity = await requirePlatformAdminPage("/platform/customers");
  const organizations = await listAdminOrganizations(prisma, identity.userId);
  // Plan column (F3b): subscriptions are readable by billing roles only.
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  const canReadBilling = platformGrants(
    admin?.status === "active" ? admin.role : null,
  )("platform.billing.read");
  const plans = canReadBilling
    ? await withIdentityContext(prisma, identity.userId, (tx) =>
        tx.subscription.findMany({
          where: { status: { not: "canceled" } },
          select: {
            organizationId: true,
            status: true,
            planVersion: { select: { plan: { select: { name: true } } } },
          },
        }),
      )
    : [];
  const planByOrg = new Map(plans.map((p) => [p.organizationId, p]));
  const t = await getTranslations("platform.customers");
  const tUsage = await getTranslations("usage");
  const format = await getFormatter();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="border-border border-b pb-5">
        <div className="flex items-center gap-3">
          <div className="bg-primary text-on-primary rounded-lg p-2">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-20 text-text font-bold tracking-tight">
              {t("title")}
            </h1>
            <p className="text-12 text-text-secondary">{t("description")}</p>
          </div>
        </div>
      </div>

      <div className="border-card-border bg-surface-card overflow-hidden rounded-xl border shadow-xs">
        <div className="border-border bg-surface-sidebar flex items-center justify-between border-b px-5 py-3.5">
          <span className="text-12 text-text-subtle font-semibold">
            {t("total", { count: organizations.length })}
          </span>
        </div>

        <div className="overflow-x-auto">
          <Table className="text-12">
            <TableHeader>
              <TableRow>
                <TableHead className="px-5">{t("colOrganization")}</TableHead>
                <TableHead className="px-5">{t("colMaxSeats")}</TableHead>
                <TableHead className="px-5">{t("colPlan")}</TableHead>
                <TableHead className="px-5">{t("colStatus")}</TableHead>
                <TableHead className="px-5">{t("colCreatedAt")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {organizations.map((org) => (
                <TableRow key={org.id}>
                  <TableCell className="px-5">
                    <div className="text-text font-semibold">{org.name}</div>
                    <div className="text-11 text-text-tertiary font-mono">
                      {org.id}
                    </div>
                  </TableCell>
                  <TableCell className="text-text-subtle px-5 font-medium">
                    {t("seats", { count: org.maxSeats })}
                  </TableCell>
                  <TableCell className="text-text-subtle px-5">
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
                  <TableCell className="px-5">
                    <span className="bg-success-bg text-success-text border-success-border text-11 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium">
                      <span className="bg-success-solid h-1.5 w-1.5 rounded-full" />
                      {org.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-text-secondary px-5">
                    {format.dateTime(org.createdAt, { dateStyle: "short" })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
