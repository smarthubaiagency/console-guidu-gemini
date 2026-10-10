import type { Metadata } from "next";
import { PlayCircle } from "lucide-react";

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

export const metadata: Metadata = { title: "Execuções de Jobs" };

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

const STATUS: Record<JobRunStatus, { label: string; tone: string }> = {
  pending: {
    label: "Na fila",
    tone: "bg-info-bg text-info-text border-info-border",
  },
  queued: {
    label: "Na fila",
    tone: "bg-info-bg text-info-text border-info-border",
  },
  running: {
    label: "Executando",
    tone: "bg-info-bg text-info-text border-info-border",
  },
  succeeded: {
    label: "Concluída",
    tone: "bg-success-bg text-success-text border-success-border",
  },
  failed: {
    label: "Falhou",
    tone: "bg-danger-bg text-danger-text border-danger-border",
  },
  skipped: {
    label: "Ignorada",
    tone: "bg-warning-bg text-warning-text border-warning-border",
  },
  canceled: { label: "Cancelada", tone: "border-border text-text-secondary" },
};

function formatTime(date: Date | null): string {
  return date ? date.toLocaleString("pt-BR") : "—";
}

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
  const canRetry = Boolean(
    data.role &&
    workspaceRoleGrants(data.role, Permissions.WORKSPACE_SETTINGS_UPDATE),
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <ModulePageHeader
        trail={["Operação", "Execuções"]}
        title="Execuções e rotinas assíncronas"
        description="Tarefas em segundo plano deste workspace. Cada execução confere de novo as permissões de quem pediu antes de agir."
        icon={<PlayCircle className="h-5 w-5" />}
      />

      <ul
        className="border-card-border bg-surface-card divide-border divide-y rounded-xl border shadow-xs"
        data-testid="job-runs"
      >
        {data.runs.map((run) => {
          const status = STATUS[run.status];
          return (
            <li
              key={run.id}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <div className="space-y-1">
                <div className="text-14 text-text flex items-center gap-2 font-semibold">
                  {getJobDefinition(run.kind)?.description ?? run.kind}
                  <span
                    className={`text-11 rounded-full border px-2 py-0.5 font-semibold ${status.tone}`}
                    data-testid="job-run-status"
                  >
                    {status.label}
                  </span>
                </div>
                <div className="text-12 text-text-secondary">
                  Pedida em {formatTime(run.createdAt)}
                  {run.finishedAt
                    ? ` · terminou em ${formatTime(run.finishedAt)}`
                    : ""}
                  {` · tentativas ${run.attempts}/${run.maxAttempts}`}
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
                  submitLabel="Reprocessar"
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
              Sem execuções registradas
            </div>
            <p className="text-12 text-text-secondary mt-1">
              Tarefas pedidas por módulos e integrações aparecem aqui.
            </p>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
