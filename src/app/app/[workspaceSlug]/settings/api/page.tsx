import type { Metadata } from "next";
import { Code2, Key } from "lucide-react";

export const metadata: Metadata = { title: "Chaves de API & Webhooks" };

export default async function ApiSettingsPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="border-b border-neutral-200 pb-5">
        <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 mb-1">
          <span>Configurações</span>
          <span>/</span>
          <span>API & Integrações</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-neutral-100 text-neutral-700">
            <Code2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-neutral-900">
              API REST & Webhooks
            </h1>
            <p className="text-xs text-neutral-500">
              Chaves de integração externa e disparo de eventos assíncronos.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-xs">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-100 text-neutral-500">
          <Key className="h-5 w-5" />
        </div>
        <h2 className="mt-4 text-sm font-semibold text-neutral-900">
          Gerenciamento de Chaves de API
        </h2>
        <p className="mt-2 text-xs text-neutral-500 max-w-md mx-auto leading-relaxed">
          Tokens com hash seguro SHA-256 e escopos delimitados por workspace, programados conforme ADR 0003 e ADR 0009.
        </p>
      </div>
    </div>
  );
}
