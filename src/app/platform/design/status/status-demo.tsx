"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { useTranslations } from "next-intl";

import { useStatus } from "@/components/feedback/status-context";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { Button } from "@/components/ui/button";

/** Showcase of the SmartStatusBanner (ADR 0016) for visual approval. */
export function StatusDemo() {
  const t = useTranslations("designLab.status");
  const { showStatus, confirmStatus, dismiss } = useStatus();
  const [answer, setAnswer] = useState<boolean | null>(null);

  const results = [
    {
      key: "up",
      run: () =>
        showStatus({
          type: "up",
          title: t("up.title"),
          message: t("up.message"),
        }),
    },
    {
      key: "oops",
      run: () =>
        showStatus({
          type: "oops",
          title: t("oops.title"),
          message: t("oops.message"),
        }),
    },
    {
      key: "down",
      run: () =>
        showStatus({
          type: "down",
          title: t("down.title"),
          message: t("down.message"),
          details: t("down.details"),
          secondaryAction: { label: t("down.secondary"), onClick: dismiss },
          action: {
            label: t("down.action"),
            onClick: () => showStatus({ type: "up", title: t("up.title") }),
          },
        }),
    },
    {
      key: "sticky",
      run: () =>
        showStatus({
          type: "oops",
          title: t("sticky.title"),
          message: t("sticky.message"),
          duration: 0,
        }),
    },
    {
      key: "same",
      run: () =>
        showStatus({
          type: "up",
          title: t("up.title"),
          message: t("up.message"),
        }),
    },
  ] as const;

  const confirmations = [
    {
      key: "confirm",
      run: async () => {
        const ok = await confirmStatus({
          title: t("confirm.title"),
          message: t("confirm.message"),
          checkboxLabel: t("confirm.checkbox"),
          confirmLabel: t("confirm.action"),
          cancelLabel: t("confirm.cancel"),
        });
        setAnswer(ok);
        showStatus(
          ok
            ? { type: "up", title: t("confirm.done") }
            : { type: "oops", title: t("confirm.kept") },
        );
      },
    },
    {
      key: "destructive",
      run: async () => {
        const ok = await confirmStatus({
          title: t("destructive.title"),
          message: t("destructive.message"),
          confirmLabel: t("destructive.action"),
          cancelLabel: t("destructive.cancel"),
          tone: "destructive",
        });
        setAnswer(ok);
        if (ok) showStatus({ type: "up", title: t("destructive.done") });
      },
    },
  ] as const;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <ModulePageHeader title={t("title")} description={t("subtitle")} />
      <div
        role="note"
        className="border-info-border bg-info-bg text-info-text text-12 flex items-center gap-2 rounded-lg border px-3 py-2"
      >
        <Info className="h-4 w-4 shrink-0" />
        {t("sampleNotice")}
      </div>
      {(
        [
          ["results", results],
          ["confirm", confirmations],
        ] as const
      ).map(([group, demos]) => (
        <section key={group} className="space-y-3">
          <h2 className="text-14 text-text font-semibold">
            {t(`groups.${group}`)}
          </h2>
          <div className="flex flex-wrap gap-2">
            {demos.map((demo) => (
              <Button
                key={demo.key}
                variant="outline"
                data-testid={`status-demo-${demo.key}`}
                onClick={() => void demo.run()}
              >
                {t(`demo.${demo.key}`)}
              </Button>
            ))}
          </div>
        </section>
      ))}
      {answer === null ? null : (
        <p className="text-12 text-text-secondary" data-testid="status-answer">
          {t("answer", { answer: answer ? t("answerYes") : t("answerNo") })}
        </p>
      )}
    </div>
  );
}
