import type { Metadata } from "next";
import { Store, Clock } from "lucide-react";

export const metadata: Metadata = { title: "Google Meu Negócio" };

export default async function GoogleBusinessPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="border-border border-b pb-5">
        <div className="text-12 text-text-secondary mb-1 flex items-center gap-2 font-medium">
          <span>Módulos</span>
          <span>/</span>
          <span>Google Meu Negócio</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-ai-bg text-ai-text border-ai-border rounded-lg border p-2">
            <Store className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-20 text-text font-bold tracking-tight">
              Google Meu Negócio
            </h1>
            <p className="text-12 text-text-secondary">
              Gestão de presença online, avaliações, horários e fotos de lojas
              físicas.
            </p>
          </div>
        </div>
      </div>

      <div className="border-border bg-surface-sidebar rounded-2xl border p-8 text-center">
        <div className="bg-ai-bg text-ai-text mx-auto flex h-10 w-10 items-center justify-center rounded-xl">
          <Clock className="h-5 w-5" />
        </div>
        <h2 className="text-14 text-text mt-4 font-semibold">
          Módulo em Desenvolvimento
        </h2>
        <p className="text-12 text-text-secondary mx-auto mt-2 max-w-md leading-relaxed">
          A integração com a Google Business Profile API depende de conectores
          OAuth globais e credenciais operacionais.
        </p>
      </div>
    </div>
  );
}
