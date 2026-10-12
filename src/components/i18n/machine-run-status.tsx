import { useFormatter, useTranslations } from "next-intl";

import type { PlatformRunView } from "@/core/jobs/service";

const count = (v: unknown) => (typeof v === "number" ? v : 0);

/**
 * Last machine translation run (I6): queued, running, succeeded with its
 * counts, or failed with the safe error of the job.
 */
export function MachineRunStatus({
  run,
  testId,
}: Readonly<{ run: PlatformRunView | null; testId?: string }>) {
  const t = useTranslations("languages.auto");
  const format = useFormatter();
  if (!run) {
    return (
      <p className="text-12 text-text-secondary" data-testid={testId}>
        {t("none")}
      </p>
    );
  }
  const when = format.dateTime(run.finishedAt ?? run.createdAt, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const remaining = count(run.result?.remaining);
  return (
    <div
      className="text-12 text-text-secondary space-y-1"
      data-testid={testId}
      data-status={run.status}
    >
      <p>
        {t("lastRun")}:{" "}
        <span className="text-text font-medium">
          {t(`status.${run.status}`)}
        </span>{" "}
        · {when}
      </p>
      {run.status === "succeeded" ? (
        <p>
          {t("counts", {
            translated: count(run.result?.translated),
            invalid: count(run.result?.invalid),
            skipped: count(run.result?.skipped),
          })}
          {remaining > 0 ? ` ${t("remaining", { count: remaining })}` : ""}
        </p>
      ) : null}
      {(run.status === "failed" || run.status === "skipped") &&
      run.lastError ? (
        <p className="text-danger-text">
          {t("error", { message: run.lastError })}
        </p>
      ) : null}
    </div>
  );
}
