import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Languages } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import {
  ActionForm,
  inputClass,
  labelClass,
} from "@/components/partners/action-form";
import { getPlatformAdminMember } from "@/core/admin/platform";
import { requirePlatformAdminPage } from "@/core/auth/page-guard";
import { MachineRunStatus } from "@/components/i18n/machine-run-status";
import {
  saveTextAction,
  translateMissingTextsAction,
} from "@/core/i18n/actions";
import { machineTranslationConfigured } from "@/core/i18n/machine/provider";
import { latestTextsRun } from "@/core/i18n/machine/requests";
import { listLanguages, listTexts } from "@/core/i18n/service";
import { platformGrants } from "@/core/module-runtime/loaders";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

export const metadata: Metadata = { title: "Textos do idioma (Admin)" };

interface PageProps {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const one = (v: string | string[] | undefined) =>
  typeof v === "string" ? v : undefined;

/** Every text of the dashboard in one language, editable one by one (I1). */
export default async function LanguageTextsPage({
  params,
  searchParams,
}: PageProps) {
  const { code } = await params;
  const query = await searchParams;
  const identity = await requirePlatformAdminPage(
    `/platform/settings/languages/${code}`,
  );
  const admin = await getPlatformAdminMember(prisma, identity.userId);
  const role = admin?.status === "active" ? admin.role : null;
  if (!platformGrants(role)("platform.languages.manage")) {
    return <ModuleNotice variant="denied" />;
  }
  const actor = { userId: identity.userId, platformRole: role };
  const t = await getTranslations("languages");
  const tc = await getTranslations("common");
  const tNav = await getTranslations("nav");
  const search = one(query.q);
  const filter = (["all", "edited", "missing", "machine"] as const).find(
    (f) => f === one(query.filter),
  );
  const data = await withIdentityContext(
    prisma,
    identity.userId,
    async (tx) => {
      const language = (await listLanguages(tx, actor)).find(
        (l) => l.code === code,
      );
      if (!language) return null;
      return {
        language,
        run: code === "pt-BR" ? null : await latestTextsRun(tx, actor, code),
        texts: await listTexts(tx, actor, code, {
          ...(search ? { search } : {}),
          filter: filter ?? "all",
          page: Number(one(query.page) ?? 1) || 1,
        }),
      };
    },
  );
  if (!data) notFound();
  const { language, texts, run } = data;
  const configured = machineTranslationConfigured();
  const inFlight =
    run?.status === "pending" ||
    run?.status === "queued" ||
    run?.status === "running";
  const base = `/platform/settings/languages/${code}`;
  const link = (page: number) => {
    const p = new URLSearchParams();
    if (search) p.set("q", search);
    if (filter) p.set("filter", filter);
    p.set("page", String(page));
    return `${base}?${p.toString()}`;
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <ModulePageHeader
        trail={[
          tNav("sections.platform.platform_settings"),
          t("title"),
          language.name,
        ]}
        title={`${t("texts")} — ${language.name}`}
        description={`${language.code} · ${t(`statuses.${language.status}`)} · ${t("count", { count: texts.total })}`}
        icon={<Languages className="h-5 w-5" />}
      />

      {code !== "pt-BR" ? (
        <section
          className="border-card-border bg-surface-card space-y-2 rounded-xl border p-4 shadow-xs"
          data-testid="machine-translation"
        >
          <h2 className="text-14 text-text font-semibold">{t("auto.title")}</h2>
          <p className="text-12 text-text-secondary">{t("auto.hint")}</p>
          <ActionForm
            action={translateMissingTextsAction}
            submitLabel={t("auto.button")}
            disabled={!configured || inFlight}
          >
            <input type="hidden" name="code" value={code} />
          </ActionForm>
          {configured ? null : (
            <p
              className="text-12 text-warning-text"
              data-testid="machine-not-configured"
            >
              {t("auto.notConfigured")}
            </p>
          )}
          <MachineRunStatus run={run} testId="machine-translation-status" />
        </section>
      ) : null}

      <form
        method="get"
        className="border-card-border bg-surface-card flex flex-wrap items-end gap-3 rounded-xl border p-4 shadow-xs"
      >
        <label className={labelClass}>
          {tc("search")}
          <input name="q" defaultValue={search ?? ""} className={inputClass} />
        </label>
        <label className={labelClass}>
          {t("status")}
          <select
            name="filter"
            defaultValue={filter ?? "all"}
            className={inputClass}
          >
            <option value="all">{t("filterAll")}</option>
            <option value="edited">{t("filterEdited")}</option>
            <option value="missing">{t("filterMissing")}</option>
            <option value="machine">{t("filterMachine")}</option>
          </select>
        </label>
        <button
          type="submit"
          className="border-border text-12 text-text rounded-lg border px-4 py-2 font-semibold"
        >
          {tc("search")}
        </button>
      </form>

      <section
        className="border-card-border bg-surface-card divide-border divide-y rounded-xl border shadow-xs"
        data-testid="language-texts"
      >
        {texts.rows.length === 0 ? (
          <p className="text-12 text-text-secondary p-6">{t("empty")}</p>
        ) : null}
        {texts.rows.map((row) => (
          <div
            key={row.key}
            className="space-y-2 p-4"
            data-testid="language-text"
          >
            <div className="flex flex-wrap items-center gap-2">
              <code className="text-11 text-text-secondary">{row.key}</code>
              {row.edit !== null ? (
                <span className="text-10 bg-surface-strong text-text-subtle rounded-sm px-1.5 py-0.5">
                  {row.origin === "machine" ? t("machine") : t("edited")}
                </span>
              ) : null}
            </div>
            {code !== "pt-BR" ? (
              <p className="text-12 text-text-secondary">
                {t("sourceText")}: {row.source}
              </p>
            ) : null}
            {row.edit !== null && row.system !== null ? (
              <p className="text-12 text-text-secondary">
                {t("systemText")}: {row.system}
              </p>
            ) : null}
            <ActionForm action={saveTextAction} submitLabel={t("saveText")}>
              <input type="hidden" name="code" value={code} />
              <input type="hidden" name="key" value={row.key} />
              <label className={`${labelClass} min-w-0 flex-1`}>
                {t("current")}
                <textarea
                  name="value"
                  rows={row.current.length > 80 ? 3 : 1}
                  maxLength={5000}
                  defaultValue={row.current}
                  className={inputClass}
                />
              </label>
            </ActionForm>
            {row.edit !== null ? (
              <ActionForm
                action={saveTextAction}
                submitLabel={t("reset")}
                tone="neutral"
              >
                <input type="hidden" name="code" value={code} />
                <input type="hidden" name="key" value={row.key} />
                <input type="hidden" name="reset" value="1" />
              </ActionForm>
            ) : null}
          </div>
        ))}
      </section>

      <nav className="text-12 flex items-center justify-between">
        {texts.page > 1 ? (
          <Link href={link(texts.page - 1)} className="text-primary">
            ← {tc("previous")}
          </Link>
        ) : (
          <span />
        )}
        <span className="text-text-secondary">
          {texts.page} / {texts.pages}
        </span>
        {texts.page < texts.pages ? (
          <Link href={link(texts.page + 1)} className="text-primary">
            {tc("next")} →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </div>
  );
}
