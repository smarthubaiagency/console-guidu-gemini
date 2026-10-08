import type { Metadata } from "next";
import { Puzzle, CheckCircle2 } from "lucide-react";

export const metadata: Metadata = { title: "Módulos do Workspace" };

export default async function ModulesSettingsPage() {
  const modules = [
    { key: "catalog", name: "Catálogo", status: "Disponível em breve" },
    { key: "google-business", name: "Google Meu Negócio", status: "Disponível em breve" },
    { key: "ai-agents", name: "Agentes de IA", status: "Disponível em breve" },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="border-b border-neutral-200 pb-5">
        <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 mb-1">
          <span>Configurações</span>
          <span>/</span>
          <span>Módulos</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-neutral-100 text-neutral-700">
            <Puzzle className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-neutral-900">
              Habilitação e Estado dos Módulos
            </h1>
            <p className="text-xs text-neutral-500">
              Conforme ADR 0005: índice de ativação por workspace e estado operacional.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white shadow-xs divide-y divide-neutral-100">
        {modules.map((m) => (
          <div key={m.key} className="p-4 flex items-center justify-between">
            <div>
              <div className="font-semibold text-sm text-neutral-900">{m.name}</div>
              <div className="text-xs text-neutral-500 font-mono">key: {m.key}</div>
            </div>
            <span className="flex items-center gap-1.5 text-xs text-neutral-600 bg-neutral-100 px-2.5 py-1 rounded-full font-medium">
              <CheckCircle2 className="h-3.5 w-3.5 text-neutral-400" />
              <span>{m.status}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
