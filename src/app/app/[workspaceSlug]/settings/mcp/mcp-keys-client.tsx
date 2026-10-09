"use client";

import { useState, useTransition } from "react";
import {
  Key,
  Plus,
  Trash2,
  Copy,
  Check,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Bot,
} from "lucide-react";
import {
  createApiKeyAction,
  revokeApiKeyAction,
  type ApiKeyActionState,
} from "@/core/credentials/api-keys-actions";
import type { ApiKeyItem } from "@/core/credentials/api-keys";
import { SCOPE_DEFINITIONS, DEFAULT_WORKSPACE_SCOPES } from "@/core/mcp/scopes";
import type { WorkspaceRole } from "@/core/permissions/roles";

export type McpKeysCapabilities = {
  canManage: boolean;
  canCreate: boolean;
  canRevokeOwn: boolean;
  canRevokeAny: boolean;
  isViewer: boolean;
};

interface McpKeysClientProps {
  workspaceSlug: string;
  apiKeys: ApiKeyItem[];
  capabilities: McpKeysCapabilities;
  currentUserId: string;
  userRole: WorkspaceRole | null;
}

export function McpKeysClient({
  workspaceSlug,
  apiKeys,
  capabilities,
  currentUserId,
  userRole,
}: McpKeysClientProps) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<ApiKeyActionState | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form State
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([...DEFAULT_WORKSPACE_SCOPES]);
  const [expiresInDays, setExpiresInDays] = useState(90);

  const isViewer = capabilities.isViewer || userRole === "viewer";

  const handleCopy = (key: string) => {
    navigator.clipboard.writeText(key);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 3000);
  };

  const handleScopeToggle = (scopeId: string) => {
    if (isViewer && scopeId === "proposals:write") {
      return;
    }
    setScopes((prev) =>
      prev.includes(scopeId)
        ? prev.filter((s) => s !== scopeId)
        : [...prev, scopeId],
    );
  };

  const handleCreateKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || name.trim().length === 0) return;

    startTransition(async () => {
      const formData = new FormData();
      formData.append("workspaceSlug", workspaceSlug);
      formData.append("name", name.trim());
      formData.append("expiresInDays", expiresInDays.toString());
      scopes.forEach((s) => formData.append("scopes", s));

      const res = await createApiKeyAction({}, formData);
      setFeedback(res);
      if (res.success) {
        setName("");
        setScopes([...DEFAULT_WORKSPACE_SCOPES]);
        setIsModalOpen(false);
      }
    });
  };

  const handleRevoke = (apiKeyId: string, keyName: string) => {
    if (
      !confirm(
        `Revogar a chave "${keyName}"? Todas as conexões e assistentes ativos usando esta chave perderão o acesso imediatamente.`,
      )
    ) {
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

  const canRevokeItem = (item: ApiKeyItem) =>
    capabilities.canRevokeAny ||
    (capabilities.canRevokeOwn && item.userId === currentUserId);

  const hasWriteScopeSelected = scopes.includes("proposals:write");

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
        <div className="border-success-border bg-success-bg text-12 text-success-text space-y-3 rounded-xl border p-5">
          <div className="flex items-center justify-between">
            <div className="text-14 flex items-center gap-2 font-bold">
              <CheckCircle2 className="text-success-solid h-4 w-4" />
              <span>Chave de API emitida com sucesso</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-success-text hover:text-success-text font-bold"
            >
              ×
            </button>
          </div>
          <p className="text-text-subtle">
            Copie o token abaixo e armazene-o com segurança. Por motivos de
            conformidade, ele nunca mais poderá ser visualizado após fechar esta
            mensagem.
          </p>
          {feedback.rawKey && (
            <div className="bg-surface-card border-success-border mt-2 flex items-center justify-between gap-3 rounded-lg border p-3 shadow-xs">
              <div className="text-12 text-text truncate font-mono font-semibold select-all">
                {feedback.rawKey}
              </div>
              <button
                type="button"
                onClick={() => handleCopy(feedback.rawKey!)}
                className="bg-primary hover:bg-primary-hover text-on-primary text-12 flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 font-semibold transition"
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
      <div className="border-card-border bg-surface-card flex flex-col justify-between gap-4 rounded-xl border p-5 shadow-xs md:flex-row md:items-center">
        <div>
          <h2 className="text-16 text-text flex items-center gap-2 font-semibold">
            <Bot className="text-text-secondary h-4 w-4" />
            <span>Conexão de Assistentes</span>
          </h2>
          <p className="text-12 text-text-secondary mt-0.5">
            Conforme ADR 0009: chaves emitidas pela plataforma com expiração
            obrigatória e hash seguro SHA-256 para assistentes de IA (Cursor, Claude Code, Codex).
          </p>
        </div>

        {capabilities.canCreate && (
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="bg-primary hover:bg-primary-hover text-on-primary text-12 flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 font-semibold shadow-xs transition"
          >
            <Plus className="h-4 w-4" />
            <span>Emitir Nova Chave</span>
          </button>
        )}
      </div>

      {/* Modal / Create Key Form */}
      {capabilities.canCreate && isModalOpen && (
        <div className="bg-overlay fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="border-card-border bg-surface-card w-full max-w-lg rounded-2xl border p-6 shadow-xl">
            <div className="border-border flex items-center justify-between border-b pb-4">
              <div className="text-text text-14 flex items-center gap-2 font-semibold">
                <Key className="text-text-subtle h-4 w-4" />
                <span>Emitir Nova Chave</span>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-text-tertiary hover:text-text-subtle text-18 leading-none"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleCreateKey} className="mt-4 space-y-4">
              <div>
                <label className="text-12 text-text-subtle mb-1 block font-medium">
                  Nome da Chave / Aplicação
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Conector Cursor / Claude Code"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="border-border-strong text-12 focus:border-focus-ring w-full rounded-lg border px-3 py-2 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-12 text-text-subtle mb-1 block font-medium">
                  Escopos de Acesso Permitidos (catálogo §17.3)
                </label>
                <div className="space-y-2">
                  {SCOPE_DEFINITIONS.map((sc) => {
                    const isChecked = scopes.includes(sc.id);
                    const isWrite = sc.isWrite;
                    const isDisabled = isWrite && isViewer;

                    return (
                      <label
                        key={sc.id}
                        className={`flex cursor-pointer items-start gap-3 rounded-lg border p-2.5 transition ${
                          isDisabled
                            ? "border-border bg-surface-raised opacity-60 cursor-not-allowed"
                            : isChecked
                              ? "border-focus-ring bg-surface-raised"
                              : "border-border hover:bg-surface-hover"
                        }`}
                      >
                        <input
                          type="checkbox"
                          value={sc.id}
                          checked={isChecked}
                          disabled={isDisabled}
                          onChange={() => handleScopeToggle(sc.id)}
                          className="mt-0.5 rounded-sm"
                        />
                        <div>
                          <div className="text-12 text-text font-medium flex items-center gap-1.5">
                            <span>{sc.label}</span>
                            {isWrite && (
                              <span className="text-10 bg-warning-bg text-warning-text border border-warning-border rounded-xs px-1 py-0.5 font-semibold">
                                Escrita
                              </span>
                            )}
                          </div>
                          <div className="text-11 text-text-secondary">
                            {sc.desc}
                          </div>
                          {isDisabled && (
                            <div className="text-10 text-danger-text mt-0.5 font-medium">
                              Apenas leitura para visualizador (sem permissão de escrita)
                            </div>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>

                {/* Mandatory Warning for proposals:write */}
                {hasWriteScopeSelected && (
                  <div className="border-warning-border bg-warning-bg text-11 text-warning-text mt-3 flex items-start gap-2 rounded-lg border p-3 font-medium">
                    <AlertTriangle className="text-warning-text h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                      <span>
                        Atenção: este escopo permite ao assistente propor alterações que exigirão aprovação humana na plataforma.
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="text-12 text-text-subtle mb-1 block font-medium">
                  Período de Validade (Expiração Obrigatória)
                </label>
                <select
                  value={expiresInDays}
                  onChange={(e) => setExpiresInDays(Number(e.target.value))}
                  className="border-border-strong text-12 focus:border-focus-ring bg-surface-card w-full rounded-lg border px-3 py-2 focus:outline-none"
                >
                  <option value={30}>30 dias</option>
                  <option value={60}>60 dias</option>
                  <option value={90}>90 dias (Recomendado)</option>
                  <option value={180}>180 dias</option>
                  <option value={365}>365 dias (1 ano)</option>
                </select>
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
                  disabled={isPending || scopes.length === 0}
                  className="bg-primary text-12 text-on-primary hover:bg-primary-hover rounded-lg px-4 py-1.5 font-semibold disabled:opacity-50"
                >
                  {isPending ? "Emitindo..." : "Emitir Chave"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Keys Table */}
      <div className="border-card-border bg-surface-card overflow-hidden rounded-xl border shadow-xs">
        <div className="border-border flex items-center justify-between border-b px-5 py-4">
          <h3 className="text-14 text-text font-semibold">
            Chaves de API Emitidas ({apiKeys.length})
          </h3>
          <span className="text-12 text-text-tertiary">
            Identificação por prefixo e auditoria de uso
          </span>
        </div>

        {apiKeys.length === 0 ? (
          <div className="text-12 text-text-tertiary p-8 text-center">
            Nenhuma chave emitida para este workspace. Crie uma chave para
            conectar assistentes MCP (Cursor, Claude Code, etc.).
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-12 w-full text-left">
              <thead className="bg-surface-raised text-text-secondary border-border border-b font-semibold tracking-wider uppercase">
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
              <tbody className="divide-border divide-y">
                {apiKeys.map((item) => (
                  <tr key={item.id} className="hover:bg-surface-hover">
                    <td className="text-text px-5 py-3.5 font-semibold">
                      {item.name}
                    </td>
                    <td className="text-text-subtle bg-surface-sidebar rounded-sm px-5 py-3.5 font-mono">
                      {item.prefix}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex flex-wrap gap-1">
                        {item.scopes.map((sc) => (
                          <span
                            key={sc}
                            className={`rounded-xs px-1.5 py-0.5 font-mono text-10 ${
                              sc === "proposals:write"
                                ? "bg-warning-bg text-warning-text border border-warning-border font-medium"
                                : "bg-surface-hover text-text-subtle"
                            }`}
                          >
                            {sc}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="text-text-secondary px-5 py-3.5">
                      {new Intl.DateTimeFormat("pt-BR", {
                        dateStyle: "short",
                      }).format(new Date(item.expiresAt))}
                    </td>
                    <td className="text-text-secondary px-5 py-3.5">
                      {item.lastUsedAt
                        ? new Intl.DateTimeFormat("pt-BR", {
                            dateStyle: "short",
                            timeStyle: "short",
                          }).format(new Date(item.lastUsedAt))
                        : "Nunca usada"}
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
                      {item.status === "active" && canRevokeItem(item) && (
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => handleRevoke(item.id, item.name)}
                          className="text-text-tertiary hover:text-danger-text hover:bg-danger-bg rounded-sm p-1 transition"
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
