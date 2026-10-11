import type { Metadata } from "next";
import { Activity } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { sectionClass } from "@/components/billing/billing-ui";
import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { platformGrants } from "@/core/module-runtime/loaders";
import { checkReadiness } from "@/core/operations/health";
import {
  ageParts,
  getOperationsOverview,
  getPrivacyOverview,
  type WorkerView,
} from "@/core/operations/service";
import { getRequestPartner } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("operations");
  return { title: t("metaTitle") };
}

const WORKER_TONE: Record<WorkerView["state"], string> = {
  online: "bg-success-bg text-success-text border-success-border",
  stopped: "border-border text-text-secondary",
  silent: "bg-danger-bg text-danger-text border-danger-border",
};

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

  const t = await getTranslations("operations");
  const tPlatform = await getTranslations("platform");
  const format = await getFormatter();
  const formatDateTime = (date: Date): string =>
    format.dateTime(date, {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Sao_Paulo",
    });
  const ageLabel = (from: Date): string => t("age", ageParts(from, now));
  const durationLabel = (ms: number | null): string => {
    if (ms === null) return "—";
    if (ms < 1000) return t("durationMs", { value: ms });
    return t("durationSeconds", {
      value: format.number(ms / 1000, { maximumFractionDigits: 1 }),
    });
  };

  return (
    <div
      className="mx-auto max-w-5xl space-y-6"
      data-testid="platform-operations"
    >
      <ModulePageHeader
        trail={[tPlatform("breadcrumb"), t("breadcrumb")]}
        title={t("title")}
        description={t("description")}
        icon={<Activity className="h-5 w-5" />}
      />

      {/* Health */}
      <section className={sectionClass} data-testid="operations-health">
        <h2 className="text-14 text-text font-semibold">{t("health.title")}</h2>
        <ul className="text-12 text-text-secondary space-y-1">
          <li>
            <span className="text-text font-semibold">
              {t("health.database")}
            </span>{" "}
            {readiness.ready
              ? t("health.dbResponding", { ms: readiness.latencyMs })
              : t("health.dbNoResponse")}
          </li>
          <li>
            <span className="text-text font-semibold">
              {t("health.workers")}
            </span>{" "}
            {data.workers.length === 0
              ? t("health.workersNone")
              : t("health.workersOnline", {
                  online,
                  total: data.workers.length,
                })}
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
                  className={`text-11 rounded-full border px-2 py-0.5 font-semibold ${WORKER_TONE[w.state]}`}
                >
                  {t(`workerState.${w.state}`)}
                </span>
                <span>
                  {t("health.workerLine", {
                    age: ageLabel(w.lastSeenAt),
                    since: formatDateTime(w.startedAt),
                    concurrency: w.concurrency,
                    queues: w.queues,
                  })}
                  {w.version
                    ? ` · ${t("health.workerVersion", { version: w.version })}`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* Queues */}
      <section className={sectionClass} data-testid="operations-queues">
        <h2 className="text-14 text-text font-semibold">{t("queues.title")}</h2>
        {metrics.capturedAt ? (
          <p className="text-12 text-text-secondary">
            {t(
              metrics.stale ? "queues.capturedStale" : "queues.capturedFresh",
              {
                age: ageLabel(metrics.capturedAt),
              },
            )}{" "}
            {t("queues.totals", {
              waiting: metrics.totals.waiting,
              running: metrics.totals.running,
            })}
          </p>
        ) : null}
        <ul className="divide-border divide-y">
          {metrics.queues.map((q) => (
            <li key={q.kind} className="text-12 text-text-secondary py-2">
              <span className="text-text font-semibold">{q.kind}</span> ·{" "}
              {t("queues.line", {
                pending: q.pending,
                queued: q.queued,
                running: q.running,
              })}
              {q.oldestPendingSeconds !== null
                ? ` · ${t("queues.oldest", { seconds: q.oldestPendingSeconds })}`
                : ""}{" "}
              ·{" "}
              {t("queues.boss", {
                waiting: q.bossWaiting,
                active: q.bossActive,
              })}
            </li>
          ))}
          {metrics.queues.length === 0 ? (
            <li className="text-12 text-text-secondary py-2">
              {t("queues.empty")}
            </li>
          ) : null}
        </ul>
      </section>

      {/* Volume */}
      <section className={sectionClass} data-testid="operations-volume">
        <h2 className="text-14 text-text font-semibold">{t("volume.title")}</h2>
        {metrics.totals.sample24h > 0 ? (
          <>
            <p className="text-12 text-text-secondary">
              {t("volume.summary", {
                sample: metrics.totals.sample24h,
                succeeded: metrics.totals.succeeded24h,
                failed: metrics.totals.failed24h,
                skipped: metrics.totals.skipped24h,
              })}
            </p>
            <ul className="divide-border divide-y">
              {metrics.queues
                .filter((q) => q.succeeded24h + q.failed24h + q.skipped24h > 0)
                .map((q) => (
                  <li key={q.kind} className="text-12 text-text-secondary py-2">
                    <span className="text-text font-semibold">{q.kind}</span> ·{" "}
                    {t("volume.queue", {
                      succeeded: q.succeeded24h,
                      failed: q.failed24h,
                      skipped: q.skipped24h,
                      avg: durationLabel(q.avgDurationMs24h),
                      p95: durationLabel(q.p95DurationMs24h),
                      sample: q.sample24h,
                    })}
                  </li>
                ))}
            </ul>
          </>
        ) : (
          <p className="text-12 text-text-secondary">{t("volume.empty")}</p>
        )}
      </section>

      {/* Failures */}
      <section className={sectionClass} data-testid="operations-failures">
        <h2 className="text-14 text-text font-semibold">
          {t("failures.title")}
        </h2>
        <ul className="divide-border divide-y">
          {data.failures.map((f) => (
            <li key={f.id} className="text-12 text-text-secondary py-2">
              <span className="text-text font-semibold">{f.kind}</span> ·{" "}
              {t(
                f.scope === "platform"
                  ? "failures.scope.platform"
                  : "failures.scope.workspace",
              )}{" "}
              · {t("failures.attempts", { count: f.attempts })} ·{" "}
              {f.finishedAt ? formatDateTime(f.finishedAt) : "—"}
              {f.lastError ? ` · ${f.lastError}` : ""}
            </li>
          ))}
          {data.failures.length === 0 ? (
            <li className="text-12 text-text-secondary py-2">
              {t("failures.empty")}
            </li>
          ) : null}
        </ul>
      </section>

      {/* Privacy (F3e) */}
      <section className={sectionClass} data-testid="operations-privacy">
        <h2 className="text-14 text-text font-semibold">
          {t("privacy.title")}
        </h2>
        <p className="text-12 text-text-secondary">{t("privacy.text")}</p>
        <ul className="divide-border divide-y" data-testid="retention-policies">
          {privacy.retention.map((r) => (
            <li key={r.category} className="text-12 text-text-secondary py-2">
              <span className="text-text font-semibold">{r.category}</span> ·{" "}
              {r.description} ·{" "}
              {r.enabled
                ? t("privacy.retentionOn", { days: r.retainDays ?? "—" })
                : r.automated
                  ? t("privacy.retentionOff")
                  : t("privacy.retentionRestricted")}
            </li>
          ))}
        </ul>
        <h3 className="text-12 text-text font-semibold">
          {t("privacy.deletionsTitle")}
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
              ·{" "}
              {t("privacy.requestedAt", {
                date: formatDateTime(d.requestedAt),
              })}{" "}
              ·{" "}
              {d.state === "purged"
                ? t("privacy.purgedAt", {
                    date: d.purgedAt ? formatDateTime(d.purgedAt) : "—",
                  })
                : d.state === "canceled"
                  ? t("privacy.canceled")
                  : t("privacy.scheduledFor", {
                      date: formatDateTime(d.purgeAfter),
                    })}
            </li>
          ))}
          {privacy.deletions.length === 0 ? (
            <li className="text-12 text-text-secondary py-2">
              {t("privacy.deletionsEmpty")}
            </li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
