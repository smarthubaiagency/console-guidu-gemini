import type { Metadata } from "next";
import { Bot, Clock } from "lucide-react";

export const metadata: Metadata = { title: "Agentes de IA" };

export default async function AiAgentsPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="border-b border-neutral-200 pb-5">
        <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 mb-1">
          <span>Módulos</span>
          <span>/</span>
          <span>Agentes de IA</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-50 text-amber-700 border border-amber-200">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-neutral-900">
              Agentes de Inteligência Artificial
            </h1>
            <p className="text-xs text-neutral-500">
              Assistentes autônomos para orquestração de tarefas, atendimento e processamento contextual.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-neutral-200 bg-neutral-50/50 p-8 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
          <Clock className="h-5 w-5" />
        </div>
        <h2 className="mt-4 text-sm font-semibold text-neutral-900">
          Módulo Programado (Tarefa 07)
        </h2>
        <p className="mt-2 text-xs text-neutral-500 max-w-md mx-auto leading-relaxed">
          Os agentes operam sob o motor de prompts e integrações com OpenAI, Anthropic e Google Gemini, com chaves BYOK criptografadas.
        </p>
      </div>
    </div>
  );
}
