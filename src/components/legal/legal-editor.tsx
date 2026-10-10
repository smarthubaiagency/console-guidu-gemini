import {
  ActionForm,
  inputClass,
  labelClass,
} from "@/components/partners/action-form";
import type { PartnerActionState } from "@/core/partners/actions";
import {
  LEGAL_KIND_LABELS,
  LEGAL_KINDS,
  type LegalDocumentView,
} from "@/core/legal/service";

type Action = (
  prev: PartnerActionState,
  formData: FormData,
) => Promise<PartnerActionState>;

/** Version list and publishing form for terms and privacy (P4b2). */
export function LegalEditor({
  documents,
  action,
}: Readonly<{ documents: readonly LegalDocumentView[]; action: Action }>) {
  return (
    <div className="space-y-6">
      <ul
        className="border-card-border bg-surface-card divide-border divide-y rounded-xl border shadow-xs"
        data-testid="legal-versions"
      >
        {documents.map((doc) => (
          <li key={doc.id} className="p-4">
            <div className="text-14 text-text font-semibold">
              {LEGAL_KIND_LABELS[doc.kind]} · versão {doc.version}
            </div>
            <div className="text-12 text-text-secondary">
              {doc.title} · {doc.publishedAt.toLocaleDateString("pt-BR")} ·{" "}
              {doc.requiresAcceptance ? "exige aceite" : "sem novo aceite"}
            </div>
          </li>
        ))}
        {documents.length === 0 ? (
          <li className="text-12 text-text-secondary p-4">
            Nenhum documento publicado. Sem documentos, ninguém precisa aceitar
            termos para entrar.
          </li>
        ) : null}
      </ul>

      <section className="border-card-border bg-surface-card space-y-3 rounded-xl border p-4 shadow-xs">
        <h2 className="text-14 text-text font-semibold">
          Publicar nova versão
        </h2>
        <ActionForm
          action={action}
          submitLabel="Publicar"
          className="space-y-3"
          testId="publish-legal"
        >
          <label className={labelClass}>
            Documento
            <select name="kind" defaultValue="terms" className={inputClass}>
              {LEGAL_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {LEGAL_KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Título
            <input
              name="title"
              required
              maxLength={120}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            Texto
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
            Mudança relevante: exigir novo aceite (a primeira versão sempre
            exige)
          </label>
        </ActionForm>
      </section>
    </div>
  );
}
