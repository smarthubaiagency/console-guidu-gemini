import { PlayCircle } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { ActionForm } from "@/components/partners/action-form";
import { requireUserPage } from "@/core/auth/page-guard";
import { retryJobRunAction } from "@/core/jobs/actions";
import { getJobDefinition } from "@/core/jobs/registry";
import { type JobRunStatus, listWorkspaceJobRuns } from "@/core/jobs/service";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { Permissions } from "@/core/permissions/catalog";
import {
  getEffectiveWorkspaceRole,
  isPermissionDeniedError,
  workspaceRoleGrants,
} from "@/core/permissions/guard";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";

export async function generateMetadata() {
  const t = await getTranslations("executions");
  return { title: t("metaTitle") };
}

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

const STATUS_TONE: Record<JobRunStatus, string> = {
  pending: "bg-info-bg text-info-text border-info-border",
  queued: "bg-info-bg text-info-text border-info-border",
  running: "bg-info-bg text-info-text border-info-border",
  succeeded: "bg-success-bg text-success-text border-success-border",
  failed: "bg-danger-bg text-danger-text border-danger-border",
  skipped: "bg-warning-bg text-warning-text border-warning-border",
  canceled: "border-border text-text-secondary",
};

/**
 * Background runs of the workspace (ADR 0002, F3a). Reads the RLS-protected
 * `job_runs` projection, never the queue schema. Owners and admins put a
 * failed run back in the queue.
 */
export default async function ExecutionsPage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const identity = await requireUserPage(`/app/${workspaceSlug}/executions`);
  const context = await resolveRequestWorkspaceContext(
    prisma,
    identity.userId,
    workspaceSlug,
  );

  let data;
  try {
    data = await withContext(prisma, context, async (tx) => ({
      runs: await listWorkspaceJobRuns(tx, context),
      role: await getEffectiveWorkspaceRole(tx, context),
    }));
  } catch (error) {
    if (isPermissionDeniedError(error))
      return <ModuleNotice variant="denied" />;
    throw error;
  }
  const t = await getTranslations("executions");
  const format = await getFormatter();
  const formatTime = (date: Date | null): string =>
    date
      ? format.dateTime(date, { dateStyle: "short", timeStyle: "medium" })
      : "—";
  const jobLabel = (kind: string): string => {
    const key = `jobs.${kind.replaceAll(".", "_")}`;
    return t.has(key) ? t(key) : (getJobDefinition(kind)?.description ?? kind);
  };
  const canRetry = Boolean(
    data.role &&
    workspaceRoleGrants(data.role, Permissions.WORKSPACE_SETTINGS_UPDATE),
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <ModulePageHeader
        title={t("title")}
        description={t("description")}
        icon={<PlayCircle className="h-5 w-5" />}
      />

      <ul
        className="border-card-border bg-surface-card divide-border divide-y rounded-xl border shadow-xs"
        data-testid="job-runs"
      >
        {data.runs.map((run) => {
          return (
            <li
              key={run.id}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <div className="space-y-1">
                <div className="text-14 text-text flex items-center gap-2 font-semibold">
                  {jobLabel(run.kind)}
                  <span
                    className={`text-11 rounded-full border px-2 py-0.5 font-semibold ${STATUS_TONE[run.status]}`}
                    data-testid="job-run-status"
                  >
                    {t(`status.${run.status}`)}
                  </span>
                </div>
                <div className="text-12 text-text-secondary">
                  {t("runMeta", {
                    createdAt: formatTime(run.createdAt),
                    finished: run.finishedAt ? "yes" : "no",
                    finishedAt: formatTime(run.finishedAt),
                    attempts: run.attempts,
                    maxAttempts: run.maxAttempts,
                  })}
                </div>
                {run.lastError ? (
                  <div className="text-12 text-danger-text">
                    {run.lastError}
                  </div>
                ) : null}
              </div>
              {canRetry && run.status === "failed" ? (
                <ActionForm
                  action={retryJobRunAction}
                  submitLabel={t("retry")}
                  tone="neutral"
                >
                  <input
                    type="hidden"
                    name="workspaceSlug"
                    value={workspaceSlug}
                  />
                  <input type="hidden" name="jobRunId" value={run.id} />
                </ActionForm>
              ) : null}
            </li>
          );
        })}
        {data.runs.length === 0 ? (
          <li className="p-8 text-center">
            <div className="text-14 text-text font-semibold">
              {t("emptyTitle")}
            </div>
            <p className="text-12 text-text-secondary mt-1">
              {t("emptyDescription")}
            </p>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
