import type { Metadata } from "next";
import { Puzzle, CheckCircle2 } from "lucide-react";

export const metadata: Metadata = { title: "Módulos do Workspace" };

export default async function ModulesSettingsPage() {
  const modules = [
    { key: "catalog", name: "Catálogo", status: "Disponível em breve" },
    {
      key: "google-business",
      name: "Google Meu Negócio",
      status: "Disponível em breve",
    },
    { key: "ai-agents", name: "Agentes de IA", status: "Disponível em breve" },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="border-border border-b pb-5">
        <div className="text-12 text-text-secondary mb-1 flex items-center gap-2 font-medium">
          <span>Configurações</span>
          <span>/</span>
          <span>Módulos</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-surface-hover text-text-subtle rounded-lg p-2">
            <Puzzle className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-20 text-text font-bold tracking-tight">
              Habilitação e Estado dos Módulos
            </h1>
            <p className="text-12 text-text-secondary">
              Conforme ADR 0005: índice de ativação por workspace e estado
              operacional.
            </p>
          </div>
        </div>
      </div>

      <div className="border-card-border bg-surface-card divide-border divide-y rounded-xl border shadow-xs">
        {modules.map((m) => (
          <div key={m.key} className="flex items-center justify-between p-4">
            <div>
              <div className="text-14 text-text font-semibold">{m.name}</div>
              <div className="text-12 text-text-secondary font-mono">
                key: {m.key}
              </div>
            </div>
            <span className="text-12 text-text-subtle bg-surface-hover flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium">
              <CheckCircle2 className="text-text-tertiary h-3.5 w-3.5" />
              <span>{m.status}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
