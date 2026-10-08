import type { Metadata } from "next";
import { Store, Clock } from "lucide-react";

export const metadata: Metadata = { title: "Google Meu Negócio" };

export default async function GoogleBusinessPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="border-b border-neutral-200 pb-5">
        <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 mb-1">
          <span>Módulos</span>
          <span>/</span>
          <span>Google Meu Negócio</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-purple-50 text-purple-700 border border-purple-200">
            <Store className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-neutral-900">
              Google Meu Negócio
            </h1>
            <p className="text-xs text-neutral-500">
              Gestão de presença online, avaliações, horários e fotos de lojas físicas.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-neutral-200 bg-neutral-50/50 p-8 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-purple-100 text-purple-700">
          <Clock className="h-5 w-5" />
        </div>
        <h2 className="mt-4 text-sm font-semibold text-neutral-900">
          Módulo em Desenvolvimento
        </h2>
        <p className="mt-2 text-xs text-neutral-500 max-w-md mx-auto leading-relaxed">
          A integração com a Google Business Profile API depende de conectores OAuth globais e credenciais operacionais.
        </p>
      </div>
    </div>
  );
}
