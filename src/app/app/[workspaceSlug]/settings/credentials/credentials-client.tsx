"use client";

import { useState, useTransition } from "react";
import {
  KeyRound,
  Plus,
  Shield,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Lock,
} from "lucide-react";
import {
  registerCredentialAction,
  revokeCredentialAction,
  type CredentialActionState,
} from "@/core/credentials/credentials-actions";
import { AI_PROVIDERS } from "@/core/credentials/providers";
import type { CredentialItem, AIProvider, CredentialPurpose } from "@/core/credentials/vault";

interface CredentialsClientProps {
  workspaceSlug: string;
  credentials: CredentialItem[];
}

export function CredentialsClient({
  workspaceSlug,
  credentials,
}: CredentialsClientProps) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<CredentialActionState | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form State
  const [provider, setProvider] = useState<AIProvider>("openai");
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [purpose, setPurpose] = useState<CredentialPurpose>("all");

  const activeProviderMeta = AI_PROVIDERS[provider];

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    if (!label || !secret) return;

    startTransition(async () => {
      const formData = new FormData();
      formData.append("workspaceSlug", workspaceSlug);
      formData.append("provider", provider);
      formData.append("label", label);
      formData.append("secret", secret);
      formData.append("purpose", purpose);

      const res = await registerCredentialAction({}, formData);
      setFeedback(res);
      if (res.success) {
        setLabel("");
        setSecret("");
        setIsModalOpen(false);
      }
    });
  };

  const handleRevoke = (credentialId: string, itemLabel: string) => {
    if (!confirm(`Revogar a credencial "${itemLabel}"? Agentes e rotinas não poderão mais utilizá-la.`)) {
      return;
    }

    startTransition(async () => {
      const formData = new FormData();
      formData.append("workspaceSlug", workspaceSlug);
      formData.append("credentialId", credentialId);

      const res = await revokeCredentialAction({}, formData);
      setFeedback(res);
    });
  };

  return (
    <div className="space-y-6">
      {/* Feedback banner */}
      {feedback?.error && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-xs font-medium text-red-700 animate-in fade-in">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
          <span>{feedback.error}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="ml-auto text-red-500 hover:text-red-700"
          >
            ×
          </button>
        </div>
      )}

      {feedback?.success && (
        <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-xs font-semibold text-emerald-800 animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span>{feedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-emerald-600 hover:text-emerald-800"
          >
            ×
          </button>
        </div>
      )}

      {/* Top Banner & Action */}
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 flex items-center gap-2">
            <Lock className="h-4 w-4 text-neutral-500" />
            <span>Cofre de Credenciais BYOK</span>
          </h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            Cadastre chaves de API próprias de provedores de IA para uso exclusivo neste workspace.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-white px-3.5 py-2 text-xs font-semibold shadow-xs transition shrink-0"
        >
          <Plus className="h-4 w-4" />
          <span>Nova Credencial</span>
        </button>
      </div>

      {/* Modal / Register Form */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-lg rounded-2xl border border-neutral-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between pb-4 border-b border-neutral-100">
              <div className="flex items-center gap-2 font-semibold text-neutral-900 text-sm">
                <KeyRound className="h-4 w-4 text-neutral-600" />
                <span>Adicionar Credencial de IA</span>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-neutral-400 hover:text-neutral-600 text-lg leading-none"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleRegister} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  Provedor de IA
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(AI_PROVIDERS) as AIProvider[]).map((pKey) => {
                    const pMeta = AI_PROVIDERS[pKey];
                    const isSelected = provider === pKey;
                    return (
                      <button
                        key={pKey}
                        type="button"
                        onClick={() => setProvider(pKey)}
                        className={`p-2.5 rounded-lg border text-left text-xs transition ${
                          isSelected
                            ? "border-neutral-900 bg-neutral-50 font-semibold text-neutral-900"
                            : "border-neutral-200 text-neutral-600 hover:bg-neutral-50/50"
                        }`}
                      >
                        <div>{pMeta.name}</div>
                        <div className="text-[10px] text-neutral-400 font-mono">
                          {pMeta.keyPrefix}*
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  Identificador / Rótulo
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Chave de Produção 2026"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs focus:border-neutral-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  Chave Secreta de API (API Key)
                </label>
                <input
                  type="password"
                  required
                  placeholder={`Insira a chave do ${activeProviderMeta.name}`}
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs font-mono focus:border-neutral-900 focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-neutral-400">
                  Formato esperado: inicia com &lsquo;{activeProviderMeta.keyPrefix}&rsquo;.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  Finalidade no Workspace
                </label>
                <select
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value as CredentialPurpose)}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs focus:border-neutral-900 focus:outline-none bg-white"
                >
                  <option value="all">Todas as finalidades (Chat e Embeddings)</option>
                  <option value="chat">Apenas Geração de Texto / Chat</option>
                  <option value="embeddings">Apenas Vetorização / Embeddings</option>
                </select>
              </div>

              <div className="rounded-lg bg-neutral-50 p-3 border border-neutral-200 flex items-start gap-2 text-[11px] text-neutral-600">
                <Shield className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
                <span>
                  O segredo é criptografado com <strong>AES-256-GCM</strong> em repouso no servidor. Após o cadastro, ele nunca mais é transmitido em claro ao navegador.
                </span>
              </div>

              <div className="mt-6 flex items-center justify-end gap-3 pt-3 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-lg bg-neutral-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
                >
                  {isPending ? "Criptografando..." : "Salvar no Cofre"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Credentials Table */}
      <div className="rounded-xl border border-neutral-200 bg-white shadow-xs overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-200 flex items-center justify-between">
          <h3 className="font-semibold text-sm text-neutral-900">
            Credenciais Ativas ({credentials.length})
          </h3>
          <span className="text-xs text-neutral-400">
            Valores mascarados com isolamento RLS
          </span>
        </div>

        {credentials.length === 0 ? (
          <div className="p-8 text-center text-xs text-neutral-400">
            Nenhuma credencial cadastrada neste workspace. Adicione uma chave para habilitar módulos de IA.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-neutral-50 text-neutral-500 uppercase tracking-wider font-semibold border-b border-neutral-200">
                <tr>
                  <th className="px-5 py-3">Provedor</th>
                  <th className="px-5 py-3">Rótulo</th>
                  <th className="px-5 py-3">Chave Mascarada</th>
                  <th className="px-5 py-3">Finalidade</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {credentials.map((item) => (
                  <tr key={item.id} className="hover:bg-neutral-50/50">
                    <td className="px-5 py-3.5 font-semibold text-neutral-900 capitalize">
                      {item.provider}
                    </td>
                    <td className="px-5 py-3.5 font-medium text-neutral-800">
                      {item.label}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-neutral-600 bg-neutral-50/50 rounded">
                      {item.maskedValue}
                    </td>
                    <td className="px-5 py-3.5 text-neutral-600 capitalize">
                      {item.purpose === "all" ? "Geral (Chat + Embeddings)" : item.purpose}
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          item.status === "active"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "bg-neutral-100 text-neutral-500"
                        }`}
                      >
                        {item.status === "active" && (
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        )}
                        {item.status === "active" ? "Ativa" : "Revogada"}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {item.status === "active" && (
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => handleRevoke(item.id, item.label)}
                          className="text-neutral-400 hover:text-red-600 transition p-1 rounded hover:bg-red-50"
                          title="Revogar credencial"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
