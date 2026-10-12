import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Languages } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { ModuleNotice } from "@/components/modules/module-notice";
import { ModulePageHeader } from "@/components/modules/module-page-header";
import { ActionForm } from "@/components/partners/action-form";
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
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";

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
        <Label className="flex-col items-start">
          {tc("search")}
          <Input name="q" defaultValue={search ?? ""} />
        </Label>
        <Label className="flex-col items-start">
          {t("status")}
          <NativeSelect
            name="filter"
            defaultValue={filter ?? "all"}
            className="w-full"
          >
            <NativeSelectOption value="all">
              {t("filterAll")}
            </NativeSelectOption>
            <NativeSelectOption value="edited">
              {t("filterEdited")}
            </NativeSelectOption>
            <NativeSelectOption value="missing">
              {t("filterMissing")}
            </NativeSelectOption>
            <NativeSelectOption value="machine">
              {t("filterMachine")}
            </NativeSelectOption>
          </NativeSelect>
        </Label>
        <Button type="submit" variant="outline">
          {tc("search")}
        </Button>
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
              <Label className="min-w-0 flex-1 flex-col items-start">
                {t("current")}
                <Textarea
                  name="value"
                  rows={row.current.length > 80 ? 3 : 1}
                  maxLength={5000}
                  defaultValue={row.current}
                />
              </Label>
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
