import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import {
  calendarDateFormatter,
  sectionClass,
} from "@/components/billing/billing-ui";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { ActionForm } from "@/components/partners/action-form";
import { requireUserPage } from "@/core/auth/page-guard";
import { workspaceGrants } from "@/core/module-runtime/loaders";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { getEffectiveWorkspaceRole } from "@/core/permissions/guard";
import {
  requestWorkspaceDeletionAction,
  requestWorkspaceExportAction,
} from "@/core/privacy/actions";
import { DELETION_GRACE_DAYS } from "@/core/privacy/deletion";
import { listWorkspaceExports } from "@/core/privacy/export";
import { exportDownloadHref } from "@/core/privacy/links";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireWorkspaceAreaPage } from "@/core/module-runtime/page-access";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("privacy");
  return { title: t("metaTitle") };
}

function formatSize(
  bytes: number | null,
  formatNumber: (value: number) => string,
): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${formatNumber(bytes / 1024 / 1024)} MB`;
}

interface DataPageProps {
  params: Promise<{ workspaceSlug: string }>;
}

/**
 * Data and privacy of the workspace (F3e, AC12): export of all its data
 * (owner and admin) and its deletion with a 30-day grace period (owner).
 * Both need verified MFA and are audited.
 */
export default async function WorkspaceDataPage({ params }: DataPageProps) {
  const { workspaceSlug } = await params;
  const identity = await requireUserPage(`/app/${workspaceSlug}/settings/data`);
  const context = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );
  // Areas beyond the dashboard need workspace.read (AT1).
  await requireWorkspaceAreaPage(context);
  const { grants, exports } = await withContext(prisma, context, async (tx) => {
    const g = workspaceGrants(await getEffectiveWorkspaceRole(tx, context));
    return {
      grants: g,
      exports: g("workspace.data.export")
        ? await listWorkspaceExports(tx, context)
        : [],
    };
  });
  const canExport = grants("workspace.data.export");
  const canDelete = grants("workspace.delete");
  if (!canExport && !canDelete) return <ModuleNotice variant="denied" />;
  const t = await getTranslations("privacy");
  const format = await getFormatter();
  const formatDate = await calendarDateFormatter();
  const formatNumber = (value: number) =>
    format.number(value, { maximumFractionDigits: 1 });

  return (
    <div className="mx-auto max-w-4xl space-y-6" data-testid="workspace-data">
      <ModulePageHeader
        title={t("title")}
        description={t("description")}
        icon={<ShieldCheck className="h-5 w-5" />}
      />

      {!identity.mfaSatisfied ? (
        <p className="text-12 bg-warning-bg text-warning-text border-warning-border rounded-lg border p-3">
          {t("mfaNotice")}
        </p>
      ) : null}

      {canExport ? (
        <section className={sectionClass} data-testid="workspace-exports">
          <h2 className="text-14 text-text font-semibold">
            {t("exportTitle")}
          </h2>
          <p className="text-12 text-text-secondary">
            {t("exportDescription")}
          </p>
          <ActionForm
            action={requestWorkspaceExportAction}
            submitLabel={t("generateExport")}
            testId="request-export"
          >
            <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
          </ActionForm>
          <ul className="divide-border divide-y">
            {exports.map((e) => (
              <li
                key={e.id}
                className="text-12 text-text-secondary flex flex-wrap items-center justify-between gap-2 py-2"
                data-testid="workspace-export"
              >
                <span>
                  <span
                    className="text-text font-semibold"
                    data-testid="export-status"
                  >
                    {t(`exportStatus.${e.status}`)}
                  </span>{" "}
                  · {t("requestedOn", { date: formatDate(e.createdAt) })} ·{" "}
                  {formatSize(e.fileSize, formatNumber)}
                  {e.status === "ready" && e.expiresAt
                    ? ` · ${t("availableUntil", {
                        date: format.dateTime(e.expiresAt, {
                          timeZone: "America/Sao_Paulo",
                          dateStyle: "short",
                          timeStyle: "short",
                        }),
                      })}`
                    : ""}
                  {e.error ? ` · ${e.error}` : ""}
                </span>
                {e.status === "ready" ? (
                  <a
                    href={exportDownloadHref(
                      workspaceSlug,
                      e.id,
                      identity.userId,
                    )}
                    className="text-12 text-text-subtle font-medium underline"
                  >
                    {t("download")}
                  </a>
                ) : null}
              </li>
            ))}
            {exports.length === 0 ? (
              <li className="text-12 text-text-secondary py-2">
                {t("noExports")}
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {canDelete ? (
        <section className={sectionClass} data-testid="workspace-deletion">
          <h2 className="text-14 text-text font-semibold">
            {t("deleteTitle")}
          </h2>
          <p className="text-12 text-text-secondary">
            {t("deleteDescription", { days: DELETION_GRACE_DAYS })}
          </p>
          <ActionForm
            action={requestWorkspaceDeletionAction}
            submitLabel={t("scheduleDeletion")}
            tone="neutral"
            className="grid gap-3 sm:grid-cols-2"
            testId="request-deletion"
          >
            <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
            <Label className="flex-col items-start">
              {t("confirmSlug", { slug: workspaceSlug })}
              <Input name="confirmSlug" required autoComplete="off" />
            </Label>
          </ActionForm>
        </section>
      ) : null}
    </div>
  );
}
