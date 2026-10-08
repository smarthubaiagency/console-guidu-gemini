import type { Metadata } from "next";
import { ShoppingBag, Clock } from "lucide-react";

export const metadata: Metadata = { title: "Catálogo de Produtos" };

export default async function CatalogPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="border-border border-b pb-5">
        <div className="text-12 text-text-secondary mb-1 flex items-center gap-2 font-medium">
          <span>Módulos</span>
          <span>/</span>
          <span>Catálogo</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-info-bg text-info-text border-info-border rounded-lg border p-2">
            <ShoppingBag className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-20 text-text font-bold tracking-tight">
              Catálogo de Produtos e Itens
            </h1>
            <p className="text-12 text-text-secondary">
              Gestão centralizada de sortimento, preços e estoque sincronizado.
            </p>
          </div>
        </div>
      </div>

      <div className="border-border bg-surface-sidebar rounded-2xl border p-8 text-center">
        <div className="bg-info-bg text-info-text mx-auto flex h-10 w-10 items-center justify-center rounded-xl">
          <Clock className="h-5 w-5" />
        </div>
        <h2 className="text-14 text-text mt-4 font-semibold">
          Módulo em Fase de Ativação (Fase 5)
        </h2>
        <p className="text-12 text-text-secondary mx-auto mt-2 max-w-md leading-relaxed">
          Conforme ADR 0003, o módulo de Catálogo será implementado após a
          consolidação da infraestrutura operacional, credenciais BYOK e MCP.
        </p>
      </div>
    </div>
  );
}
