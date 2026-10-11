import { useFormatter, useTranslations } from "next-intl";

import {
  ActionForm,
  inputClass,
  labelClass,
} from "@/components/partners/action-form";
import type { PartnerActionState } from "@/core/partners/actions";
import { LEGAL_KINDS, type LegalDocumentView } from "@/core/legal/service";

type Action = (
  prev: PartnerActionState,
  formData: FormData,
) => Promise<PartnerActionState>;

/** Version list and publishing form for terms and privacy (P4b2). */
export function LegalEditor({
  documents,
  action,
}: Readonly<{ documents: readonly LegalDocumentView[]; action: Action }>) {
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
          <label className={labelClass}>
            {t("editor.document")}
            <select name="kind" defaultValue="terms" className={inputClass}>
              {LEGAL_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`kinds.${kind}`)}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            {t("editor.title")}
            <input
              name="title"
              required
              maxLength={120}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            {t("editor.body")}
            <textarea
              name="body"
              required
              rows={10}
              maxLength={100000}
              className={inputClass}
            />
          </label>
          <label className="text-14 text-text flex items-center gap-2">
            <input type="checkbox" name="requiresAcceptance" defaultChecked />
            {t("editor.requiresAcceptanceLabel")}
          </label>
        </ActionForm>
      </section>
    </div>
  );
}
