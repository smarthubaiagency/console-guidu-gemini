import type { Metadata } from "next";
import { ShoppingBag, Clock } from "lucide-react";

export const metadata: Metadata = { title: "Catálogo de Produtos" };

export default async function CatalogPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="border-b border-neutral-200 pb-5">
        <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 mb-1">
          <span>Módulos</span>
          <span>/</span>
          <span>Catálogo</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-50 text-blue-700 border border-blue-200">
            <ShoppingBag className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-neutral-900">
              Catálogo de Produtos e Itens
            </h1>
            <p className="text-xs text-neutral-500">
              Gestão centralizada de sortimento, preços e estoque sincronizado.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-neutral-200 bg-neutral-50/50 p-8 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
          <Clock className="h-5 w-5" />
        </div>
        <h2 className="mt-4 text-sm font-semibold text-neutral-900">
          Módulo em Fase de Ativação (Fase 5)
        </h2>
        <p className="mt-2 text-xs text-neutral-500 max-w-md mx-auto leading-relaxed">
          Conforme ADR 0003, o módulo de Catálogo será implementado após a consolidação da infraestrutura operacional, credenciais BYOK e MCP.
        </p>
      </div>
    </div>
  );
}
