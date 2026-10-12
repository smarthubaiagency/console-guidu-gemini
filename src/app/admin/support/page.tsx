import type { Metadata } from "next";
import Link from "next/link";
import { Hand } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { ActionForm } from "@/components/partners/action-form";
import { supportStatusKey } from "@/components/partners/support-status";
import { requirePartnerConsolePage } from "@/core/auth/page-guard";
import { partnerGrants } from "@/core/module-runtime/loaders";
import {
  endOwnSupportGrantAction,
  requestSupportAccessAction,
} from "@/core/partners/actions";
import { listPartnerCustomers } from "@/core/partners/members";
import {
  listPartnerSupportGrants,
  MAX_SUPPORT_HOURS,
  type SupportGrantView,
} from "@/core/partners/support";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("partnerConsole");
  return { title: t("support.metaTitle") };
}

const DATE_TIME = { dateStyle: "short", timeStyle: "medium" } as const;

/** Temporary support access requests of the partner (ADR 0012, P4b2). */
export default async function PartnerSupportPage() {
  const { identity, partner, membership } =
    await requirePartnerConsolePage("/admin/support");
  if (!partnerGrants(membership.role)("partner.support.request")) {
    return <ModuleNotice variant="denied" />;
  }

  const { customers, grants } = await withIdentityContext(
    prisma,
    identity.userId,
    async (tx) => ({
      customers: await listPartnerCustomers(tx, partner.partnerId),
      grants: await listPartnerSupportGrants(tx, partner.partnerId),
    }),
    { partnerId: partner.partnerId },
  );
  const names = new Map(customers.map((c) => [c.id, c.name]));
  const t = await getTranslations("partnerConsole");
  const tAll = await getTranslations();
  const format = await getFormatter();
  const statusLabel = (grant: SupportGrantView): string => {
    const status = supportStatusKey(grant);
    if (!status) return grant.status;
    return status.date
      ? tAll(status.key, { date: format.dateTime(status.date, DATE_TIME) })
      : tAll(status.key);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <ModulePageHeader
        title={t("support.title")}
        description={t("support.description")}
        icon={<Hand className="h-5 w-5" />}
      />

      <section className="border-card-border bg-surface-card space-y-3 rounded-xl border p-4 shadow-xs">
        <h2 className="text-14 text-text font-semibold">
          {t("support.newTitle")}
        </h2>
        <ActionForm
          action={requestSupportAccessAction}
          submitLabel={t("support.submit")}
          className="grid gap-3 sm:grid-cols-2"
          testId="request-support"
        >
          <Label className="flex-col items-start">
            {t("support.customer")}
            <NativeSelect name="organizationId" required className="w-full">
              {customers.map((customer) => (
                <NativeSelectOption key={customer.id} value={customer.id}>
                  {customer.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Label>
          <Label className="flex-col items-start">
            {t("support.duration", { max: MAX_SUPPORT_HOURS })}
            <Input
              name="durationHours"
              type="number"
              min={1}
              max={MAX_SUPPORT_HOURS}
              defaultValue={4}
              required
            />
          </Label>
          <Label className="flex-col items-start sm:col-span-2">
            {t("support.reason")}
            <Textarea
              name="reason"
              required
              minLength={10}
              maxLength={500}
              rows={3}
            />
          </Label>
        </ActionForm>
      </section>

      <ul
        className="border-card-border bg-surface-card divide-border divide-y rounded-xl border shadow-xs"
        data-testid="partner-support-grants"
      >
        {grants.map((grant) => (
          <li
            key={grant.id}
            className="flex flex-wrap items-center justify-between gap-4 p-4"
          >
            <div>
              <div className="text-14 text-text font-semibold">
                {names.get(grant.organizationId) ?? t("support.customer")} ·{" "}
                {grant.granteeEmail}
              </div>
              <div className="text-12 text-text-secondary">
                {statusLabel(grant)} ·{" "}
                {t("support.hours", { hours: grant.durationHours })} ·{" "}
                {grant.reason}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {grant.active && grant.workspaceSlug ? (
                <Link
                  href={`/app/${grant.workspaceSlug}`}
                  className="text-12 text-text-subtle font-medium underline"
                >
                  {t("support.openWorkspace")}
                </Link>
              ) : null}
              {grant.status === "pending" || grant.active ? (
                <ActionForm
                  action={endOwnSupportGrantAction}
                  submitLabel={
                    grant.status === "pending"
                      ? t("support.cancel")
                      : t("support.end")
                  }
                  tone="neutral"
                >
                  <input type="hidden" name="grantId" value={grant.id} />
                </ActionForm>
              ) : null}
            </div>
          </li>
        ))}
        {grants.length === 0 ? (
          <li className="text-12 text-text-secondary p-4">
            {t("support.empty")}
          </li>
        ) : null}
      </ul>
    </div>
  );
}
