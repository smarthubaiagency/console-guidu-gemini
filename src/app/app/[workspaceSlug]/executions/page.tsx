import type { Metadata } from "next";
import { PlayCircle, AlertCircle } from "lucide-react";

export const metadata: Metadata = { title: "Execuções de Jobs" };

export default async function ExecutionsPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="border-b border-neutral-200 pb-5">
        <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 mb-1">
          <span>Operação</span>
          <span>/</span>
          <span>Execuções</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-neutral-100 text-neutral-700 border border-neutral-200">
            <PlayCircle className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-neutral-900">
              Execuções e Rotinas Assíncronas
            </h1>
            <p className="text-xs text-neutral-500">
              Fila de processamento em segundo plano suportada por pg-boss e worker independente.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-xs">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-100 text-neutral-500">
          <AlertCircle className="h-5 w-5" />
        </div>
        <h2 className="mt-4 text-sm font-semibold text-neutral-900">
          Sem execuções registradas
        </h2>
        <p className="mt-2 text-xs text-neutral-500 max-w-md mx-auto leading-relaxed">
          Nenhum job em fila ou concluído para este workspace no momento. Execuções disparadas por módulos e integrações aparecerão aqui.
        </p>
      </div>
    </div>
  );
}
