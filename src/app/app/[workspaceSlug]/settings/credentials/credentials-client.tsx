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
import type {
  CredentialItem,
  AIProvider,
  CredentialPurpose,
} from "@/core/credentials/vault";

export type CredentialsCapabilities = {
  canManage: boolean;
  canRead: boolean;
};

interface CredentialsClientProps {
  workspaceSlug: string;
  credentials: CredentialItem[];
  capabilities: CredentialsCapabilities;
}

export function CredentialsClient({
  workspaceSlug,
  credentials,
  capabilities,
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
    if (
      !confirm(
        `Revogar a credencial "${itemLabel}"? Agentes e rotinas não poderão mais utilizá-la.`,
      )
    ) {
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
        <div className="border-danger-border bg-danger-bg text-12 text-danger-text flex items-center gap-3 rounded-lg border p-4 font-medium">
          <AlertCircle className="text-danger-text h-4 w-4 shrink-0" />
          <span>{feedback.error}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-danger-text hover:text-danger-text ml-auto"
          >
            ×
          </button>
        </div>
      )}

      {feedback?.success && (
        <div className="border-success-border bg-success-bg text-12 text-success-text flex items-center justify-between rounded-lg border p-4 font-semibold">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="text-success-solid h-4 w-4" />
            <span>{feedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-success-solid hover:text-success-text"
          >
            ×
          </button>
        </div>
      )}

      {/* Top Banner & Action */}
      <div className="border-card-border bg-surface-card flex flex-col justify-between gap-4 rounded-xl border p-5 shadow-xs md:flex-row md:items-center">
        <div>
          <h2 className="text-16 text-text flex items-center gap-2 font-semibold">
            <Lock className="text-text-secondary h-4 w-4" />
            <span>Cofre de Credenciais BYOK</span>
          </h2>
          <p className="text-12 text-text-secondary mt-0.5">
            Cadastre chaves de API próprias de provedores de IA para uso
            exclusivo neste workspace.
          </p>
        </div>

        {capabilities.canManage && (
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="bg-primary hover:bg-primary-hover text-on-primary text-12 flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 font-semibold shadow-xs transition"
          >
            <Plus className="h-4 w-4" />
            <span>Nova Credencial</span>
          </button>
        )}
      </div>

      {/* Modal / Register Form */}
      {capabilities.canManage && isModalOpen && (
        <div className="bg-overlay fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="border-card-border bg-surface-card w-full max-w-lg rounded-2xl border p-6 shadow-xl">
            <div className="border-border flex items-center justify-between border-b pb-4">
              <div className="text-text text-14 flex items-center gap-2 font-semibold">
                <KeyRound className="text-text-subtle h-4 w-4" />
                <span>Adicionar Credencial de IA</span>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-text-tertiary hover:text-text-subtle text-18 leading-none"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleRegister} className="mt-4 space-y-4">
              <div>
                <label className="text-12 text-text-subtle mb-1 block font-medium">
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
                        className={`text-12 rounded-lg border p-2.5 text-left transition ${
                          isSelected
                            ? "border-focus-ring bg-surface-raised text-text font-semibold"
                            : "border-border text-text-subtle hover:bg-surface-hover"
                        }`}
                      >
                        <div>{pMeta.name}</div>
                        <div className="text-10 text-text-tertiary font-mono">
                          {pMeta.keyPrefix}*
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="text-12 text-text-subtle mb-1 block font-medium">
                  Identificador / Rótulo
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Chave de Produção 2026"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="border-border-strong text-12 focus:border-focus-ring w-full rounded-lg border px-3 py-2 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-12 text-text-subtle mb-1 block font-medium">
                  Chave Secreta de API (API Key)
                </label>
                <input
                  type="password"
                  required
                  placeholder={`Insira a chave do ${activeProviderMeta.name}`}
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  className="border-border-strong text-12 focus:border-focus-ring w-full rounded-lg border px-3 py-2 font-mono focus:outline-none"
                />
                <p className="text-11 text-text-tertiary mt-1">
                  Formato esperado: inicia com &lsquo;
                  {activeProviderMeta.keyPrefix}&rsquo;.
                </p>
              </div>

              <div>
                <label className="text-12 text-text-subtle mb-1 block font-medium">
                  Finalidade no Workspace
                </label>
                <select
                  value={purpose}
                  onChange={(e) =>
                    setPurpose(e.target.value as CredentialPurpose)
                  }
                  className="border-border-strong text-12 focus:border-focus-ring bg-surface-card w-full rounded-lg border px-3 py-2 focus:outline-none"
                >
                  <option value="all">
                    Todas as finalidades (Chat e Embeddings)
                  </option>
                  <option value="chat">Apenas Geração de Texto / Chat</option>
                  <option value="embeddings">
                    Apenas Vetorização / Embeddings
                  </option>
                </select>
              </div>

              <div className="bg-surface-raised border-border text-11 text-text-subtle flex items-start gap-2 rounded-lg border p-3">
                <Shield className="text-success-solid mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  O segredo é criptografado com <strong>AES-256-GCM</strong> em
                  repouso no servidor. Após o cadastro, ele nunca mais é
                  transmitido em claro ao navegador.
                </span>
              </div>

              <div className="border-border mt-6 flex items-center justify-end gap-3 border-t pt-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="border-border-strong text-12 text-text-subtle hover:bg-surface-hover rounded-lg border px-3 py-1.5 font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="bg-primary text-12 text-on-primary hover:bg-primary-hover rounded-lg px-4 py-1.5 font-semibold disabled:opacity-50"
                >
                  {isPending ? "Criptografando..." : "Salvar no Cofre"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Credentials Table */}
      <div className="border-card-border bg-surface-card overflow-hidden rounded-xl border shadow-xs">
        <div className="border-border flex items-center justify-between border-b px-5 py-4">
          <h3 className="text-14 text-text font-semibold">
            Credenciais Ativas ({credentials.length})
          </h3>
          <span className="text-12 text-text-tertiary">
            Valores mascarados com isolamento RLS
          </span>
        </div>

        {credentials.length === 0 ? (
          <div className="text-12 text-text-tertiary p-8 text-center">
            {!capabilities.canRead
              ? "Você não possui permissão para visualizar credenciais deste workspace."
              : "Nenhuma credencial cadastrada neste workspace. Adicione uma chave para habilitar módulos de IA."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-12 w-full text-left">
              <thead className="bg-surface-raised text-text-secondary border-border border-b font-semibold tracking-wider uppercase">
                <tr>
                  <th className="px-5 py-3">Provedor</th>
                  <th className="px-5 py-3">Rótulo</th>
                  <th className="px-5 py-3">Chave Mascarada</th>
                  <th className="px-5 py-3">Finalidade</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">
                    {capabilities.canManage ? "Ações" : ""}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {credentials.map((item) => (
                  <tr key={item.id} className="hover:bg-surface-hover">
                    <td className="text-text px-5 py-3.5 font-semibold capitalize">
                      {item.provider}
                    </td>
                    <td className="text-text px-5 py-3.5 font-medium">
                      {item.label}
                    </td>
                    <td className="text-text-subtle bg-surface-sidebar rounded-sm px-5 py-3.5 font-mono">
                      {item.maskedValue}
                    </td>
                    <td className="text-text-subtle px-5 py-3.5 capitalize">
                      {item.purpose === "all"
                        ? "Geral (Chat + Embeddings)"
                        : item.purpose}
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`text-10 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${
                          item.status === "active"
                            ? "bg-success-bg text-success-text border-success-border border"
                            : "bg-surface-hover text-text-secondary"
                        }`}
                      >
                        {item.status === "active" && (
                          <span className="bg-success-solid h-1.5 w-1.5 rounded-full" />
                        )}
                        {item.status === "active" ? "Ativa" : "Revogada"}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {capabilities.canManage && item.status === "active" && (
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => handleRevoke(item.id, item.label)}
                          className="text-text-tertiary hover:text-danger-text hover:bg-danger-bg rounded-sm p-1 transition"
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
