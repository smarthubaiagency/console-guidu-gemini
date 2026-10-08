import type { Metadata } from "next";
import { KeyRound, Shield } from "lucide-react";

export const metadata: Metadata = { title: "Credenciais BYOK" };

export default async function CredentialsPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="border-b border-neutral-200 pb-5">
        <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 mb-1">
          <span>Configurações</span>
          <span>/</span>
          <span>Credenciais</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-neutral-100 text-neutral-700">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-neutral-900">
              Credenciais e Cofre BYOK
            </h1>
            <p className="text-xs text-neutral-500">
              Gestão de chaves de provedores de IA (OpenAI, Gemini, Anthropic) com criptografia em repouso.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-xs">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-100 text-neutral-500">
          <Shield className="h-5 w-5" />
        </div>
        <h2 className="mt-4 text-sm font-semibold text-neutral-900">
          Cofre Criptografado (Tarefa 06)
        </h2>
        <p className="mt-2 text-xs text-neutral-500 max-w-md mx-auto leading-relaxed">
          As credenciais BYOK serão cadastradas na próxima etapa (Tarefa 06), com cifragem AES-256-GCM no servidor e sem exposição de segredos ao cliente.
        </p>
      </div>
    </div>
  );
}
