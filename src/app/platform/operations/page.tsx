import type { Metadata } from "next";
import { Activity } from "lucide-react";

import { sectionClass } from "@/components/billing/billing-ui";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { platformGrants } from "@/core/module-runtime/loaders";
import { checkReadiness } from "@/core/operations/health";
import {
  ageLabel,
  durationLabel,
  getOperationsOverview,
  getPrivacyOverview,
  type WorkerView,
} from "@/core/operations/service";
import { getRequestPartner } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export const metadata: Metadata = { title: "Operações (Admin)" };

const WORKER_STATE: Record<
  WorkerView["state"],
  { label: string; tone: string }
> = {
  online: {
    label: "Em funcionamento",
    tone: "bg-success-bg text-success-text border-success-border",
  },
  stopped: {
    label: "Parado",
    tone: "border-border text-text-secondary",
  },
  silent: {
    label: "Sem sinal",
    tone: "bg-danger-bg text-danger-text border-danger-border",
  },
};

function formatDateTime(date: Date): string {
  return date.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  });
}

/**
 * Operations (F3d): health of the web and the workers, queues per job kind,
 * recent failures and the job volume of the last 24 hours, each with its
 * sample. Owner, operations and support read it.
 */
export default async function PlatformOperationsPage() {
  const identity = await requirePlatformAdminPage("/platform/operations");
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  const role = admin?.status === "active" ? admin.role : null;
  if (!platformGrants(role)("platform.operations.read")) {
    return <ModuleNotice variant="denied" />;
  }
  const partner = await getRequestPartner();
  const readiness = await checkReadiness(prisma);

  const data = await withIdentityContext(
    prisma,
    identity.userId,
    (tx) =>
      getOperationsOverview(tx, {
        userId: identity.userId,
        platformRole: role,
      }),
    { partnerId: partner?.partnerId ?? null },
  );
  const privacy = await withIdentityContext(
    prisma,
    identity.userId,
    (tx) =>
      getPrivacyOverview(tx, {
        userId: identity.userId,
        platformRole: role,
      }),
    { partnerId: partner?.partnerId ?? null },
  );
  const { metrics, generatedAt: now } = data;
  const online = data.workers.filter((w) => w.state === "online").length;

  return (
    <div
      className="mx-auto max-w-5xl space-y-6"
      data-testid="platform-operations"
    >
      <ModulePageHeader
        trail={["Administração", "Operações"]}
        title="Operações"
        description="Saúde do web e dos workers, filas, falhas e volume de execuções. Os números de fila vêm do worker a cada minuto; cada um mostra a amostra de onde saiu."
        icon={<Activity className="h-5 w-5" />}
      />

      {/* Health */}
      <section className={sectionClass} data-testid="operations-health">
        <h2 className="text-14 text-text font-semibold">Saúde</h2>
        <ul className="text-12 text-text-secondary space-y-1">
          <li>
            <span className="text-text font-semibold">Banco de dados:</span>{" "}
            {readiness.ready
              ? `respondendo (${readiness.latencyMs} ms nesta consulta)`
              : "sem resposta"}
          </li>
          <li>
            <span className="text-text font-semibold">Workers:</span>{" "}
            {data.workers.length === 0
              ? "Sem dados — nenhum worker registrou sinal."
              : `${online} de ${data.workers.length} em funcionamento`}
          </li>
        </ul>
        {data.workers.length > 0 ? (
          <ul
            className="divide-border divide-y"
            data-testid="operations-workers"
          >
            {data.workers.map((w) => (
              <li
                key={w.instanceName}
                className="text-12 text-text-secondary flex flex-wrap items-center gap-2 py-2"
              >
                <span className="text-text font-semibold">
                  {w.instanceName}
                </span>
                <span
                  className={`text-11 rounded-full border px-2 py-0.5 font-semibold ${WORKER_STATE[w.state].tone}`}
                >
                  {WORKER_STATE[w.state].label}
                </span>
                <span>
                  último sinal {ageLabel(w.lastSeenAt, now)} · desde{" "}
                  {formatDateTime(w.startedAt)} · {w.concurrency} por vez ·{" "}
                  {w.queues} fila(s)
                  {w.version ? ` · versão ${w.version}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* Queues */}
      <section className={sectionClass} data-testid="operations-queues">
        <h2 className="text-14 text-text font-semibold">Filas</h2>
        {metrics.capturedAt ? (
          <p className="text-12 text-text-secondary">
            Capturado {ageLabel(metrics.capturedAt, now)}
            {metrics.stale
              ? " — desatualizado: o worker não publica há mais de 5 minutos."
              : "."}{" "}
            Aguardando {metrics.totals.waiting} · em execução{" "}
            {metrics.totals.running}.
          </p>
        ) : null}
        <ul className="divide-border divide-y">
          {metrics.queues.map((q) => (
            <li key={q.kind} className="text-12 text-text-secondary py-2">
              <span className="text-text font-semibold">{q.kind}</span> ·
              pendentes {q.pending} · na fila {q.queued} · em execução{" "}
              {q.running}
              {q.oldestPendingSeconds !== null
                ? ` · pendente mais antigo há ${q.oldestPendingSeconds} s`
                : ""}{" "}
              · pg-boss: {q.bossWaiting} aguardando, {q.bossActive} ativos
            </li>
          ))}
          {metrics.queues.length === 0 ? (
            <li className="text-12 text-text-secondary py-2">
              Sem dados — o worker ainda não publicou métricas.
            </li>
          ) : null}
        </ul>
      </section>

      {/* Volume */}
      <section className={sectionClass} data-testid="operations-volume">
        <h2 className="text-14 text-text font-semibold">
          Execuções nas últimas 24 horas
        </h2>
        {metrics.totals.sample24h > 0 ? (
          <>
            <p className="text-12 text-text-secondary">
              Amostra: {metrics.totals.sample24h} execução(ões) concluídas ·{" "}
              {metrics.totals.succeeded24h} com sucesso ·{" "}
              {metrics.totals.failed24h} com falha · {metrics.totals.skipped24h}{" "}
              ignoradas.
            </p>
            <ul className="divide-border divide-y">
              {metrics.queues
                .filter((q) => q.succeeded24h + q.failed24h + q.skipped24h > 0)
                .map((q) => (
                  <li key={q.kind} className="text-12 text-text-secondary py-2">
                    <span className="text-text font-semibold">{q.kind}</span> ·{" "}
                    {q.succeeded24h} sucesso · {q.failed24h} falha ·{" "}
                    {q.skipped24h} ignoradas · duração média{" "}
                    {durationLabel(q.avgDurationMs24h)} · p95{" "}
                    {durationLabel(q.p95DurationMs24h)} (amostra {q.sample24h})
                  </li>
                ))}
            </ul>
          </>
        ) : (
          <p className="text-12 text-text-secondary">Sem dados.</p>
        )}
      </section>

      {/* Failures */}
      <section className={sectionClass} data-testid="operations-failures">
        <h2 className="text-14 text-text font-semibold">
          Falhas dos últimos 7 dias
        </h2>
        <ul className="divide-border divide-y">
          {data.failures.map((f) => (
            <li key={f.id} className="text-12 text-text-secondary py-2">
              <span className="text-text font-semibold">{f.kind}</span> ·{" "}
              {f.scope === "platform" ? "plataforma" : "workspace"} ·{" "}
              {f.attempts} tentativa(s) ·{" "}
              {f.finishedAt ? formatDateTime(f.finishedAt) : "—"}
              {f.lastError ? ` · ${f.lastError}` : ""}
            </li>
          ))}
          {data.failures.length === 0 ? (
            <li className="text-12 text-text-secondary py-2">
              Nenhuma falha registrada.
            </li>
          ) : null}
        </ul>
      </section>

      {/* Privacy (F3e) */}
      <section className={sectionClass} data-testid="operations-privacy">
        <h2 className="text-14 text-text font-semibold">Privacidade</h2>
        <p className="text-12 text-text-secondary">
          Retenção por categoria: desligada até as regras do jurídico; a mudança
          vem por migration. Exclusões de workspace são concluídas pela rotina
          diária depois de 30 dias de carência.
        </p>
        <ul className="divide-border divide-y" data-testid="retention-policies">
          {privacy.retention.map((r) => (
            <li key={r.category} className="text-12 text-text-secondary py-2">
              <span className="text-text font-semibold">{r.category}</span> ·{" "}
              {r.description} ·{" "}
              {r.enabled
                ? `ligada: ${r.retainDays} dias`
                : r.automated
                  ? "desligada (aguardando o jurídico)"
                  : "processo restrito, sem remoção automática"}
            </li>
          ))}
        </ul>
        <h3 className="text-12 text-text font-semibold">
          Exclusões de workspace
        </h3>
        <ul
          className="divide-border divide-y"
          data-testid="workspace-deletions"
        >
          {privacy.deletions.map((d) => (
            <li
              key={`${d.workspaceId}-${d.requestedAt.toISOString()}`}
              className="text-12 text-text-secondary py-2"
            >
              <span className="text-text font-semibold">{d.workspaceName}</span>{" "}
              · pedida em {formatDateTime(d.requestedAt)} ·{" "}
              {d.state === "purged"
                ? `concluída em ${d.purgedAt ? formatDateTime(d.purgedAt) : "—"}`
                : d.state === "canceled"
                  ? "cancelada"
                  : `agendada para ${formatDateTime(d.purgeAfter)}`}
            </li>
          ))}
          {privacy.deletions.length === 0 ? (
            <li className="text-12 text-text-secondary py-2">
              Nenhuma exclusão pedida.
            </li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
