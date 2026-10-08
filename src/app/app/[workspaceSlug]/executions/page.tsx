import type { Metadata } from "next";
import { PlayCircle, AlertCircle } from "lucide-react";

export const metadata: Metadata = { title: "Execuções de Jobs" };

export default async function ExecutionsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="border-border border-b pb-5">
        <div className="text-12 text-text-secondary mb-1 flex items-center gap-2 font-medium">
          <span>Operação</span>
          <span>/</span>
          <span>Execuções</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-surface-hover text-text-subtle border-border rounded-lg border p-2">
            <PlayCircle className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-20 text-text font-bold tracking-tight">
              Execuções e Rotinas Assíncronas
            </h1>
            <p className="text-12 text-text-secondary">
              Fila de processamento em segundo plano suportada por pg-boss e
              worker independente.
            </p>
          </div>
        </div>
      </div>

      <div className="border-card-border bg-surface-card rounded-2xl border p-8 text-center shadow-xs">
        <div className="bg-surface-hover text-text-secondary mx-auto flex h-10 w-10 items-center justify-center rounded-xl">
          <AlertCircle className="h-5 w-5" />
        </div>
        <h2 className="text-14 text-text mt-4 font-semibold">
          Sem execuções registradas
        </h2>
        <p className="text-12 text-text-secondary mx-auto mt-2 max-w-md leading-relaxed">
          Nenhum job em fila ou concluído para este workspace no momento.
          Execuções disparadas por módulos e integrações aparecerão aqui.
        </p>
      </div>
    </div>
  );
}
