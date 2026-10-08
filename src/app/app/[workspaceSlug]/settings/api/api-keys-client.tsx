"use client";

import { useState, useTransition } from "react";
import {
  Key,
  Plus,
  Shield,
  Trash2,
  Copy,
  Check,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import {
  createApiKeyAction,
  revokeApiKeyAction,
  type ApiKeyActionState,
} from "@/core/credentials/api-keys-actions";
import type { ApiKeyItem } from "@/core/credentials/api-keys";

interface ApiKeysClientProps {
  workspaceSlug: string;
  apiKeys: ApiKeyItem[];
}

export function ApiKeysClient({
  workspaceSlug,
  apiKeys,
}: ApiKeysClientProps) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<ApiKeyActionState | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form State
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["read", "mcp:read"]);
  const [expiresInDays, setExpiresInDays] = useState(90);

  const availableScopes = [
    { id: "read", label: "Leitura Geral (read)", desc: "Consulta a recursos e metadados do workspace" },
    { id: "write", label: "Escrita (write)", desc: "Criação e mutação de recursos operacionais" },
    { id: "mcp:read", label: "MCP Leitura (mcp:read)", desc: "Acesso a ferramentas de leitura em assistentes de IA" },
    { id: "mcp:write", label: "MCP Escrita (mcp:write)", desc: "Aprovação e submissão de alterações via MCP" },
  ];

  const handleCopy = (key: string) => {
    navigator.clipboard.writeText(key);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 3000);
  };

  const handleScopeToggle = (scopeId: string) => {
    setScopes((prev) =>
      prev.includes(scopeId)
        ? prev.filter((s) => s !== scopeId)
        : [...prev, scopeId],
    );
  };

  const handleCreateKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;

    startTransition(async () => {
      const formData = new FormData();
      formData.append("workspaceSlug", workspaceSlug);
      formData.append("name", name);
      formData.append("expiresInDays", expiresInDays.toString());
      scopes.forEach((s) => formData.append("scopes", s));

      const res = await createApiKeyAction({}, formData);
      setFeedback(res);
      if (res.success) {
        setName("");
        setIsModalOpen(false);
      }
    });
  };

  const handleRevoke = (apiKeyId: string, keyName: string) => {
    if (!confirm(`Revogar a chave "${keyName}"? Todas as conexões e assistentes ativos usando esta chave perderão o acesso imediatamente.`)) {
      return;
    }

    startTransition(async () => {
      const formData = new FormData();
      formData.append("workspaceSlug", workspaceSlug);
      formData.append("apiKeyId", apiKeyId);

      const res = await revokeApiKeyAction({}, formData);
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
        <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-xs text-emerald-900 animate-in fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span>Chave de API emitida com sucesso</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-emerald-700 hover:text-emerald-900 font-bold"
            >
              ×
            </button>
          </div>
          <p className="text-neutral-600">
            Copie o token abaixo e armazene-o com segurança. Por motivos de conformidade, ele nunca mais poderá ser visualizado após fechar esta mensagem.
          </p>
          {feedback.rawKey && (
            <div className="mt-2 rounded-lg bg-white border border-emerald-300 p-3 flex items-center justify-between gap-3 shadow-xs">
              <div className="font-mono text-xs truncate select-all text-neutral-900 font-semibold">
                {feedback.rawKey}
              </div>
              <button
                type="button"
                onClick={() => handleCopy(feedback.rawKey!)}
                className="flex items-center gap-1.5 shrink-0 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 text-xs font-semibold transition"
              >
                {copiedKey === feedback.rawKey ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    <span>Copiada!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copiar Chave</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Top Banner & Action */}
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 flex items-center gap-2">
            <Key className="h-4 w-4 text-neutral-500" />
            <span>Tokens de API & Autenticação MCP</span>
          </h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            Conforme ADR 0009: chaves emitidas pela plataforma com expiração obrigatória e hash seguro SHA-256.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-white px-3.5 py-2 text-xs font-semibold shadow-xs transition shrink-0"
        >
          <Plus className="h-4 w-4" />
          <span>Emitir Nova Chave</span>
        </button>
      </div>

      {/* Modal / Create Key Form */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-lg rounded-2xl border border-neutral-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between pb-4 border-b border-neutral-100">
              <div className="flex items-center gap-2 font-semibold text-neutral-900 text-sm">
                <Key className="h-4 w-4 text-neutral-600" />
                <span>Emitir Nova Chave de API</span>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-neutral-400 hover:text-neutral-600 text-lg leading-none"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleCreateKey} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  Nome da Chave / Aplicação
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Conector Cursor / Claude Code"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs focus:border-neutral-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1.5">
                  Escopos de Acesso (ADR 0009)
                </label>
                <div className="space-y-2">
                  {availableScopes.map((scope) => {
                    const isChecked = scopes.includes(scope.id);
                    return (
                      <label
                        key={scope.id}
                        className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition ${
                          isChecked
                            ? "border-neutral-900 bg-neutral-50/50"
                            : "border-neutral-200 hover:bg-neutral-50/30"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleScopeToggle(scope.id)}
                          className="mt-0.5 rounded text-neutral-900 focus:ring-neutral-900"
                        />
                        <div className="text-xs">
                          <div className="font-semibold text-neutral-900">
                            {scope.label}
                          </div>
                          <div className="text-[11px] text-neutral-500">
                            {scope.desc}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  Validade / Expiração Obrigatória
                </label>
                <select
                  value={expiresInDays}
                  onChange={(e) => setExpiresInDays(Number(e.target.value))}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs focus:border-neutral-900 focus:outline-none bg-white"
                >
                  <option value={30}>30 dias</option>
                  <option value={60}>60 dias</option>
                  <option value={90}>90 dias (Recomendado)</option>
                  <option value={180}>180 dias</option>
                  <option value={365}>1 ano</option>
                </select>
              </div>

              <div className="rounded-lg bg-neutral-50 p-3 border border-neutral-200 flex items-start gap-2 text-[11px] text-neutral-600">
                <Shield className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
                <span>
                  O hash <strong>SHA-256</strong> é armazenado no banco. Tokens de API não são tokens do Supabase e operam estritamente sob o contexto do workspace.
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
                  disabled={isPending || scopes.length === 0}
                  className="rounded-lg bg-neutral-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
                >
                  {isPending ? "Emitindo..." : "Emitir Chave"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Keys Table */}
      <div className="rounded-xl border border-neutral-200 bg-white shadow-xs overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-200 flex items-center justify-between">
          <h3 className="font-semibold text-sm text-neutral-900">
            Chaves de API Emitidas ({apiKeys.length})
          </h3>
          <span className="text-xs text-neutral-400">
            Identificação por prefixo e auditoria de uso
          </span>
        </div>

        {apiKeys.length === 0 ? (
          <div className="p-8 text-center text-xs text-neutral-400">
            Nenhuma chave emitida para este workspace. Crie uma chave para conectar assistentes MCP ou integrações REST.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-neutral-50 text-neutral-500 uppercase tracking-wider font-semibold border-b border-neutral-200">
                <tr>
                  <th className="px-5 py-3">Nome</th>
                  <th className="px-5 py-3">Prefixo</th>
                  <th className="px-5 py-3">Escopos</th>
                  <th className="px-5 py-3">Expira em</th>
                  <th className="px-5 py-3">Último uso</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {apiKeys.map((item) => (
                  <tr key={item.id} className="hover:bg-neutral-50/50">
                    <td className="px-5 py-3.5 font-semibold text-neutral-900">
                      {item.name}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-neutral-600 bg-neutral-50/50 rounded">
                      {item.prefix}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex flex-wrap gap-1">
                        {item.scopes.map((sc) => (
                          <span
                            key={sc}
                            className="rounded-xs bg-neutral-100 px-1.5 py-0.5 text-[10px] font-mono text-neutral-700"
                          >
                            {sc}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-neutral-500">
                      {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(
                        new Date(item.expiresAt),
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-neutral-500">
                      {item.lastUsedAt
                        ? new Intl.DateTimeFormat("pt-BR", {
                            dateStyle: "short",
                            timeStyle: "short",
                          }).format(new Date(item.lastUsedAt))
                        : "Nunca usada"}
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
                          onClick={() => handleRevoke(item.id, item.name)}
                          className="text-neutral-400 hover:text-red-600 transition p-1 rounded hover:bg-red-50"
                          title="Revogar chave"
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
