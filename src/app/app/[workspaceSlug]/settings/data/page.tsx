import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";

import { formatDate, sectionClass } from "@/components/billing/billing-ui";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import {
  ActionForm,
  inputClass,
  labelClass,
} from "@/components/partners/action-form";
import { requireUserPage } from "@/core/auth/page-guard";
import { workspaceGrants } from "@/core/module-runtime/loaders";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { getEffectiveWorkspaceRole } from "@/core/permissions/guard";
import {
  requestWorkspaceDeletionAction,
  requestWorkspaceExportAction,
} from "@/core/privacy/actions";
import { DELETION_GRACE_DAYS } from "@/core/privacy/deletion";
import { type ExportStatus, listWorkspaceExports } from "@/core/privacy/export";
import { exportDownloadHref } from "@/core/privacy/links";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";

export const metadata: Metadata = { title: "Dados e privacidade" };

const STATUS_LABELS: Record<ExportStatus, string> = {
  pending: "Na fila",
  running: "Gerando",
  ready: "Pronta",
  failed: "Falhou",
  expired: "Expirada",
};

function formatSize(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
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

  return (
    <div className="mx-auto max-w-4xl space-y-6" data-testid="workspace-data">
      <ModulePageHeader
        trail={["Configurações", "Dados e privacidade"]}
        title="Dados e privacidade"
        description="Exporte todos os dados deste workspace ou peça a exclusão dele."
        icon={<ShieldCheck className="h-5 w-5" />}
      />

      {!identity.mfaSatisfied ? (
        <p className="text-12 bg-warning-bg text-warning-text border-warning-border rounded-lg border p-3">
          Exportar e excluir pedem a verificação em duas etapas nesta sessão.
          Ative ou confirme em Segurança da conta.
        </p>
      ) : null}

      {canExport ? (
        <section className={sectionClass} data-testid="workspace-exports">
          <h2 className="text-14 text-text font-semibold">Exportação</h2>
          <p className="text-12 text-text-secondary">
            Um arquivo JSON com membros, convites, chaves de API e credenciais
            (sem segredos), módulos, execuções e os dados de cada módulo. Ele é
            gerado em segundo plano e fica disponível por 24 horas; o link de
            download vale 15 minutos e pode ser gerado de novo recarregando a
            página.
          </p>
          <ActionForm
            action={requestWorkspaceExportAction}
            submitLabel="Gerar exportação"
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
                    {STATUS_LABELS[e.status]}
                  </span>{" "}
                  · pedida em {formatDate(e.createdAt)} ·{" "}
                  {formatSize(e.fileSize)}
                  {e.status === "ready" && e.expiresAt
                    ? ` · disponível até ${e.expiresAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}`
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
                    Baixar
                  </a>
                ) : null}
              </li>
            ))}
            {exports.length === 0 ? (
              <li className="text-12 text-text-secondary py-2">
                Nenhuma exportação ainda.
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {canDelete ? (
        <section className={sectionClass} data-testid="workspace-deletion">
          <h2 className="text-14 text-text font-semibold">Excluir workspace</h2>
          <p className="text-12 text-text-secondary">
            O workspace fica bloqueado para todos assim que a exclusão é
            agendada. Durante {DELETION_GRACE_DAYS} dias você pode cancelar na
            lista de workspaces. Depois disso os dados, membros, chaves,
            credenciais e arquivos são apagados de forma definitiva; fica só o
            registro de que o workspace existiu e foi excluído, e a auditoria.
            Cópias de backup seguem o prazo próprio e não voltam a ficar
            acessíveis. Exporte antes se precisar dos dados.
          </p>
          <ActionForm
            action={requestWorkspaceDeletionAction}
            submitLabel="Agendar exclusão"
            tone="neutral"
            className="grid gap-3 sm:grid-cols-2"
            testId="request-deletion"
          >
            <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
            <label className={labelClass}>
              Digite {workspaceSlug} para confirmar
              <input
                name="confirmSlug"
                required
                autoComplete="off"
                className={inputClass}
              />
            </label>
          </ActionForm>
        </section>
      ) : null}
    </div>
  );
}
