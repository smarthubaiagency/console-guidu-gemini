import { useFormatter, useTranslations } from "next-intl";

import { ActionForm } from "@/components/partners/action-form";
import { MachineRunStatus } from "@/components/i18n/machine-run-status";
import type { PlatformRunView } from "@/core/jobs/service";
import type { PartnerActionState } from "@/core/partners/actions";
import { SOURCE_LOCALE } from "@/core/i18n/locales";
import {
  LEGAL_KINDS,
  type LegalDocumentView,
  type LegalLanguage,
  type LegalTranslationView,
} from "@/core/legal/service";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

type Action = (
  prev: PartnerActionState,
  formData: FormData,
) => Promise<PartnerActionState>;

export type LegalTranslationActions = Readonly<{
  save: Action;
  remove: Action;
  /** Machine translation of a version (I6). */
  machine?: Readonly<{
    action: Action;
    /** A provider is configured in this environment. */
    configured: boolean;
    /** Latest run per document id. */
    runs: Readonly<Record<string, PlatformRunView>>;
  }>;
}>;

/**
 * Version list and publishing form for terms and privacy (P4b2), with the
 * translations of each version per dashboard language (I5).
 */
export function LegalEditor({
  documents,
  action,
  languages = [],
  translations = [],
  translationActions,
}: Readonly<{
  documents: readonly LegalDocumentView[];
  action: Action;
  languages?: readonly LegalLanguage[];
  translations?: readonly LegalTranslationView[];
  translationActions?: LegalTranslationActions;
}>) {
  const t = useTranslations("legal");
  const format = useFormatter();
  return (
    <div className="space-y-6">
      <ul
        className="border-card-border bg-surface-card divide-border divide-y rounded-xl border shadow-xs"
        data-testid="legal-versions"
      >
        {documents.map((doc) => (
          <li key={doc.id} className="p-4">
            <div className="text-14 text-text font-semibold">
              {t("editor.version", {
                kind: t(`kinds.${doc.kind}`),
                version: doc.version,
              })}
            </div>
            <div className="text-12 text-text-secondary">
              {doc.title} ·{" "}
              {format.dateTime(doc.publishedAt, {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
              })}{" "}
              ·{" "}
              {doc.requiresAcceptance
                ? t("editor.requiresAcceptance")
                : t("editor.noNewAcceptance")}
            </div>
            {translationActions && languages.length > 1 ? (
              <LegalTranslations
                document={doc}
                languages={languages}
                translations={translations.filter(
                  (tr) => tr.documentId === doc.id,
                )}
                actions={translationActions}
              />
            ) : null}
          </li>
        ))}
        {documents.length === 0 ? (
          <li className="text-12 text-text-secondary p-4">
            {t("editor.empty")}
          </li>
        ) : null}
      </ul>

      <section className="border-card-border bg-surface-card space-y-3 rounded-xl border p-4 shadow-xs">
        <h2 className="text-14 text-text font-semibold">
          {t("editor.publishTitle")}
        </h2>
        <ActionForm
          action={action}
          submitLabel={t("editor.publish")}
          className="space-y-3"
          testId="publish-legal"
        >
          <Label className="flex-col items-start">
            {t("editor.document")}
            <NativeSelect name="kind" defaultValue="terms" className="w-full">
              {LEGAL_KINDS.map((kind) => (
                <NativeSelectOption key={kind} value={kind}>
                  {t(`kinds.${kind}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Label>
          {languages.length > 1 ? (
            <Label className="flex-col items-start">
              {t("editor.originalLocale")}
              <NativeSelect
                name="locale"
                defaultValue={SOURCE_LOCALE}
                className="w-full"
              >
                {languages.map((language) => (
                  <NativeSelectOption key={language.code} value={language.code}>
                    {language.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Label>
          ) : null}
          <Label className="flex-col items-start">
            {t("editor.title")}
            <Input name="title" required maxLength={120} />
          </Label>
          <Label className="flex-col items-start">
            {t("editor.body")}
            <Textarea name="body" required rows={10} maxLength={100000} />
          </Label>
          <Label className="text-14 text-text font-normal">
            <Checkbox name="requiresAcceptance" defaultChecked />
            {t("editor.requiresAcceptanceLabel")}
          </Label>
        </ActionForm>
      </section>
    </div>
  );
}

/** Translations of one version: status per language and the edit forms. */
function LegalTranslations({
  document,
  languages,
  translations,
  actions,
}: Readonly<{
  document: LegalDocumentView;
  languages: readonly LegalLanguage[];
  translations: readonly LegalTranslationView[];
  actions: LegalTranslationActions;
}>) {
  const t = useTranslations("legal");
  const targets = languages.filter((l) => l.code !== document.locale);
  const done = targets.filter((l) =>
    translations.some((tr) => tr.locale === l.code),
  ).length;
  const original = languages.find((l) => l.code === document.locale);
  return (
    <details
      className="mt-2"
      data-testid={`legal-translations-${document.kind}-${document.version}`}
    >
      <summary className="text-12 text-text-subtle cursor-pointer font-medium">
        {t("translations.summary", { done, total: targets.length })}
      </summary>
      <div className="mt-2 space-y-2">
        <p className="text-12 text-text-secondary">{t("translations.hint")}</p>
        <p className="text-12 text-text-secondary">
          {original?.name ?? document.locale} · {t("translations.original")}
        </p>
        {actions.machine ? (
          <LegalMachineTranslation
            document={document}
            machine={actions.machine}
          />
        ) : null}
        <ul className="space-y-2">
          {targets.map((language) => {
            const translation = translations.find(
              (tr) => tr.locale === language.code,
            );
            const status = translation
              ? t(`translations.${translation.origin}`)
              : t("translations.missing");
            return (
              <li
                key={language.code}
                className="border-border rounded-lg border p-2"
                data-testid={`legal-translation-${language.code}`}
              >
                <details>
                  <summary className="text-12 text-text cursor-pointer">
                    <span className="font-medium">{language.name}</span>
                    {language.status === "draft"
                      ? ` (${t("translations.draft")})`
                      : ""}{" "}
                    · {status} ·{" "}
                    <span className="underline">
                      {translation
                        ? t("translations.edit")
                        : t("translations.add")}
                    </span>
                  </summary>
                  <div className="mt-2 space-y-2">
                    <ActionForm
                      action={actions.save}
                      submitLabel={t("translations.save")}
                      className="space-y-2"
                    >
                      <input
                        type="hidden"
                        name="documentId"
                        value={document.id}
                      />
                      <input
                        type="hidden"
                        name="locale"
                        value={language.code}
                      />
                      <Label className="flex-col items-start">
                        {t("editor.title")}
                        <Input
                          name="title"
                          required
                          maxLength={120}
                          defaultValue={translation?.title ?? ""}
                          placeholder={document.title}
                        />
                      </Label>
                      <Label className="flex-col items-start">
                        {t("editor.body")}
                        <Textarea
                          name="body"
                          required
                          rows={8}
                          maxLength={100000}
                          defaultValue={translation?.body ?? ""}
                        />
                      </Label>
                    </ActionForm>
                    {translation ? (
                      <ActionForm
                        action={actions.remove}
                        submitLabel={t("translations.remove")}
                        tone="neutral"
                      >
                        <input
                          type="hidden"
                          name="documentId"
                          value={document.id}
                        />
                        <input
                          type="hidden"
                          name="locale"
                          value={language.code}
                        />
                      </ActionForm>
                    ) : null}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      </div>
    </details>
  );
}

/** "Traduzir automaticamente" for one version, with its last run (I6). */
function LegalMachineTranslation({
  document,
  machine,
}: Readonly<{
  document: LegalDocumentView;
  machine: NonNullable<LegalTranslationActions["machine"]>;
}>) {
  const t = useTranslations("legal");
  const tm = useTranslations("languages.auto");
  const run = machine.runs[document.id] ?? null;
  const inFlight =
    run?.status === "pending" ||
    run?.status === "queued" ||
    run?.status === "running";
  return (
    <div
      className="border-border space-y-1 rounded-lg border p-2"
      data-testid={`legal-machine-${document.kind}-${document.version}`}
    >
      <p className="text-12 text-text-secondary">{t("machine.hint")}</p>
      <ActionForm
        action={machine.action}
        submitLabel={t("machine.button")}
        tone="neutral"
        disabled={!machine.configured || inFlight}
      >
        <input type="hidden" name="documentId" value={document.id} />
      </ActionForm>
      {machine.configured ? null : (
        <p className="text-12 text-warning-text">{tm("notConfigured")}</p>
      )}
      <MachineRunStatus run={run} />
    </div>
  );
}
