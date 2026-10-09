/**
 * ============================================================================
 * File: src/app/app/[workspaceSlug]/ai-agents/agents-client.tsx
 * Module: AI Prompt & Agent Interactive Chat Interface
 *
 * Maintenance Rationale:
 * - Implements interactive execution of AI Prompts with persona switching,
 *   transparent fallback badges, execution latency, and session history.
 * - BYOK credentials remain protected inside the server vault.
 * - Client receives only sanitized interaction responses and audit metrics.
 * ============================================================================
 */

"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import {
  Bot,
  User,
  Send,
  Plus,
  MessageSquare,
  Sparkles,
  AlertTriangle,
  Clock,
  Coins,
  Cpu,
  Layers,
  CheckCircle2,
  AlertCircle,
  Settings,
} from "lucide-react";
import {
  executePromptAction,
  createAgentConfigAction,
  loadSessionMessagesAction,
} from "@/core/agents/actions";
import type {
  AgentConfigData,
  AgentSessionData,
  AgentMessageData,
} from "@/core/agents/engine";
import type { AIProvider } from "@/core/credentials/vault";

interface AgentsClientProps {
  workspaceSlug: string;
  initialConfigs: AgentConfigData[];
  initialSessions: AgentSessionData[];
  initialMessages?: AgentMessageData[];
}

export function AgentsClient({
  workspaceSlug,
  initialConfigs,
  initialSessions,
  initialMessages = [],
}: AgentsClientProps) {
  const [configs, setConfigs] = useState<AgentConfigData[]>(initialConfigs);
  const [sessions, setSessions] = useState<AgentSessionData[]>(initialSessions);
  const [selectedConfigId, setSelectedConfigId] = useState<string>(
    initialConfigs[0]?.id || "",
  );
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    initialSessions[0]?.id || null,
  );
  const [messages, setMessages] = useState<AgentMessageData[]>(initialMessages);
  const [promptInput, setPromptInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [feedback, setFeedback] = useState<{
    error?: string;
    success?: string;
  } | null>(null);

  // Modal create agent state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCreatingConfig, startCreateTransition] = useTransition();
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentDesc, setNewAgentDesc] = useState("");
  const [newAgentSystemPrompt, setNewAgentSystemPrompt] = useState("");
  const [newPrimaryProvider, setNewPrimaryProvider] =
    useState<AIProvider>("openai");
  const [newPrimaryModel, setNewPrimaryModel] = useState("gpt-4o-mini");
  const [newFallbackProvider, setNewFallbackProvider] = useState<
    AIProvider | ""
  >("gemini");
  const [newFallbackModel, setNewFallbackModel] = useState("gemini-2.5-flash");
  const [newTemperature, setNewTemperature] = useState(0.7);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  const handleSelectSession = (sessionId: string) => {
    setSelectedSessionId(sessionId);
    setFeedback(null);
    setIsLoadingMessages(true);

    loadSessionMessagesAction(workspaceSlug, sessionId)
      .then((res) => {
        if (res.error) {
          setFeedback({ error: res.error });
        } else {
          setMessages(res.messages);
        }
      })
      .catch((err) => {
        setFeedback({ error: String(err) });
      })
      .finally(() => {
        setIsLoadingMessages(false);
      });
  };

  const handleStartNewChat = () => {
    setSelectedSessionId(null);
    setMessages([]);
    setFeedback(null);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPrompt = promptInput.trim();
    if (!cleanPrompt || isSending) return;

    setFeedback(null);
    setIsSending(true);
    setPromptInput("");

    // Optimistic user message
    const optimisticUserMsg: AgentMessageData = {
      id: "opt-" + Date.now(),
      organizationId: "",
      workspaceId: "",
      sessionId: selectedSessionId || "new",
      role: "user",
      content: cleanPrompt,
      providerUsed: "user",
      modelUsed: "user",
      fallbackTriggered: false,
      latencyMs: 0,
      tokensEstimated: Math.ceil(cleanPrompt.length / 4),
      createdAt: new Date(),
    };

    setMessages((prev) => [...prev, optimisticUserMsg]);

    const formData = new FormData();
    formData.append("workspaceSlug", workspaceSlug);
    formData.append("prompt", cleanPrompt);
    if (selectedConfigId) formData.append("agentConfigId", selectedConfigId);
    if (selectedSessionId) formData.append("sessionId", selectedSessionId);

    try {
      const res = await executePromptAction({}, formData);
      if (res.error || !res.result) {
        setFeedback({ error: res.error || "Falha na resposta do assistente." });
        // remove optimistic message
        setMessages((prev) =>
          prev.filter((m) => m.id !== optimisticUserMsg.id),
        );
      } else {
        const { session, userMessage, assistantMessage } = res.result;

        // update session selection and list
        setSelectedSessionId(session.id);
        setSessions((prev) => {
          const exists = prev.some((s) => s.id === session.id);
          if (exists) {
            return [session, ...prev.filter((s) => s.id !== session.id)];
          }
          return [session, ...prev];
        });

        // replace optimistic message and append assistant reply
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== optimisticUserMsg.id),
          userMessage,
          assistantMessage,
        ]);
      }
    } catch {
      setFeedback({ error: "Falha na comunicação ao enviar mensagem. Tente novamente." });
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUserMsg.id));
    } finally {
      setIsSending(false);
    }
  };

  const handleCreateAgent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAgentName || !newAgentSystemPrompt) return;

    startCreateTransition(async () => {
      const formData = new FormData();
      formData.append("workspaceSlug", workspaceSlug);
      formData.append("name", newAgentName);
      formData.append("description", newAgentDesc);
      formData.append("systemPrompt", newAgentSystemPrompt);
      formData.append("primaryProvider", newPrimaryProvider);
      formData.append("primaryModel", newPrimaryModel);
      if (newFallbackProvider)
        formData.append("fallbackProvider", newFallbackProvider);
      if (newFallbackModel) formData.append("fallbackModel", newFallbackModel);
      formData.append("temperature", String(newTemperature));

      const res = await createAgentConfigAction({}, formData);
      if (res.error) {
        setFeedback({ error: res.error });
      } else if (res.config) {
        setConfigs((prev) => [...prev, res.config!]);
        setSelectedConfigId(res.config.id);
        setIsModalOpen(false);
        setNewAgentName("");
        setNewAgentDesc("");
        setFeedback({
          success: `Agente "${res.config.name}" criado com sucesso!`,
        });
      }
    });
  };

  const activeConfig = configs.find((c) => c.id === selectedConfigId);

  return (
    <div className="h-panel flex min-h-150 flex-col gap-6 lg:flex-row">
      {/* Sidebar: Sessions & Persona switcher */}
      <aside className="border-card-border bg-surface-card flex w-full flex-col gap-4 rounded-2xl border p-4 shadow-sm lg:w-80">
        {/* Active persona picker */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-12 text-text-subtle flex items-center gap-1.5 font-semibold">
              <Cpu className="text-text-secondary h-3.5 w-3.5" />
              Persona do Agente
            </label>
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="text-12 text-info-text hover:text-info-text flex items-center gap-1 font-medium"
            >
              <Plus className="h-3 w-3" />
              Novo
            </button>
          </div>

          <select
            value={selectedConfigId}
            onChange={(e) => setSelectedConfigId(e.target.value)}
            className="border-border-strong bg-surface-sidebar text-12 text-text focus:ring-focus-ring w-full rounded-xl border px-3 py-2 font-medium focus:ring-2 focus:outline-none"
          >
            {configs.length === 0 && (
              <option value="">Assistente Padrão</option>
            )}
            {configs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.primaryProvider})
              </option>
            ))}
          </select>

          {activeConfig && (
            <div className="bg-surface-raised border-border text-12 text-text-subtle mt-2 space-y-1 rounded-xl border p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-text font-semibold">
                  {activeConfig.name}
                </span>
                <span className="text-10 bg-info-bg text-info-text rounded-sm px-1.5 py-0.5 font-mono">
                  {activeConfig.primaryProvider}:{activeConfig.primaryModel}
                </span>
              </div>
              {activeConfig.description && (
                <p className="text-11 text-text-secondary line-clamp-1">
                  {activeConfig.description}
                </p>
              )}
              {activeConfig.fallbackProvider && (
                <div className="text-10 text-warning-text flex items-center gap-1 pt-0.5 font-medium">
                  <Layers className="h-3 w-3" />
                  <span>
                    Fallback: {activeConfig.fallbackProvider}:
                    {activeConfig.fallbackModel}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* New chat button */}
        <button
          type="button"
          onClick={handleStartNewChat}
          className="bg-primary text-12 text-on-primary hover:bg-primary-hover flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 font-semibold shadow-sm transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Nova Conversa
        </button>

        {/* Chat History List */}
        <div className="flex-1 space-y-1 overflow-y-auto pr-1">
          <div className="text-11 text-text-tertiary px-2 py-1 font-semibold tracking-wider uppercase">
            Histórico Recente
          </div>
          {sessions.length === 0 ? (
            <div className="text-12 text-text-tertiary py-6 text-center">
              Nenhuma conversa registrada.
            </div>
          ) : (
            sessions.map((s) => {
              const isSelected = selectedSessionId === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => handleSelectSession(s.id)}
                  className={`text-12 flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors ${
                    isSelected
                      ? "bg-info-bg text-info-text border-info-border border font-medium"
                      : "text-text-subtle hover:bg-surface-hover"
                  }`}
                >
                  <MessageSquare
                    className={`h-3.5 w-3.5 shrink-0 ${isSelected ? "text-info-text" : "text-text-tertiary"}`}
                  />
                  <span className="flex-1 truncate">{s.title}</span>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* Main Chat Panel */}
      <main className="border-card-border bg-surface-card flex flex-1 flex-col overflow-hidden rounded-2xl border shadow-sm">
        {/* Chat Top Banner */}
        <div className="border-border bg-surface-raised flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="bg-info-bg text-info-text flex h-9 w-9 items-center justify-center rounded-xl">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <div className="text-14 text-text flex items-center gap-2 font-semibold">
                <span>
                  {activeConfig ? activeConfig.name : "Assistente Padrão"}
                </span>
                <span className="text-11 bg-success-bg text-success-text rounded-full px-2 py-0.5 font-normal">
                  Online
                </span>
              </div>
              <p className="text-12 text-text-secondary">
                {activeConfig?.description ||
                  "Assistente inteligente com suporte a chaves BYOK e fallbacks"}
              </p>
            </div>
          </div>

          <div className="text-12 text-text-secondary flex items-center gap-2">
            <span className="hidden sm:inline">Motor resiliente:</span>
            <span className="bg-surface-strong text-11 text-text-subtle rounded-sm px-2 py-1 font-mono">
              {activeConfig?.primaryProvider || "BYOK"}
            </span>
          </div>
        </div>

        {/* Feedback message */}
        {feedback?.error && (
          <div className="border-danger-border bg-danger-bg text-12 text-danger-text m-4 flex items-center gap-2 rounded-xl border p-3">
            <AlertCircle className="text-danger-text h-4 w-4 shrink-0" />
            <span className="flex-1">{feedback.error}</span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-danger-text hover:text-danger-text"
            >
              ×
            </button>
          </div>
        )}

        {feedback?.success && (
          <div className="border-success-border bg-success-bg text-12 text-success-text m-4 flex items-center gap-2 rounded-xl border p-3">
            <CheckCircle2 className="text-success-solid h-4 w-4 shrink-0" />
            <span className="flex-1">{feedback.success}</span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-success-solid hover:text-success-solid"
            >
              ×
            </button>
          </div>
        )}

        {/* Messages Stream */}
        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {isLoadingMessages ? (
            <div className="text-12 text-text-tertiary flex h-full items-center justify-center gap-2">
              <Clock className="h-4 w-4 animate-spin" />
              Carregando histórico da conversa...
            </div>
          ) : messages.length === 0 ? (
            <div className="mx-auto flex h-full max-w-sm flex-col items-center justify-center space-y-3 text-center">
              <div className="bg-surface-hover text-text-tertiary flex h-12 w-12 items-center justify-center rounded-2xl">
                <Sparkles className="text-text-secondary h-6 w-6" />
              </div>
              <h3 className="text-14 text-text font-semibold">
                Inicie uma nova interação
              </h3>
              <p className="text-12 text-text-secondary leading-relaxed">
                Envie perguntas, solicitações de geração ou comandos de
                automação. As consultas serão executadas pelo provedor primário
                com redundância automática.
              </p>
            </div>
          ) : (
            messages.map((m) => {
              const isUser = m.role === "user";
              return (
                <div
                  key={m.id}
                  className={`flex max-w-2xl gap-3 ${
                    isUser ? "ml-auto flex-row-reverse" : "mr-auto"
                  }`}
                >
                  <div
                    className={`text-12 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                      isUser
                        ? "bg-primary text-on-primary"
                        : "bg-primary text-on-primary"
                    }`}
                  >
                    {isUser ? (
                      <User className="h-4 w-4" />
                    ) : (
                      <Bot className="h-4 w-4" />
                    )}
                  </div>

                  <div className="flex flex-col space-y-1.5">
                    <div
                      className={`text-12 rounded-2xl px-4 py-3 leading-relaxed whitespace-pre-wrap ${
                        isUser
                          ? "bg-primary text-on-primary rounded-tr-none"
                          : "bg-surface-hover text-text border-border rounded-tl-none border"
                      }`}
                    >
                      {m.content}
                    </div>

                    {/* Metadata tags for assistant messages */}
                    {!isUser && (
                      <div className="text-10 text-text-secondary flex flex-wrap items-center gap-2 px-1">
                        {m.fallbackTriggered && (
                          <span className="text-warning-text bg-warning-bg border-warning-border flex items-center gap-1 rounded-md border px-2 py-0.5 font-semibold">
                            <AlertTriangle className="text-warning-solid h-3 w-3" />
                            Fallback Acionado
                          </span>
                        )}
                        <span className="bg-surface-hover border-border text-text-subtle rounded-sm border px-1.5 py-0.5 font-mono">
                          {m.providerUsed}:{m.modelUsed}
                        </span>
                        {m.latencyMs > 0 && (
                          <span className="text-text-secondary flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {m.latencyMs} ms
                          </span>
                        )}
                        {m.tokensEstimated > 0 && (
                          <span className="text-text-secondary flex items-center gap-1">
                            <Coins className="h-3 w-3" />~{m.tokensEstimated}{" "}
                            tokens
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}

          {/* Typing indicator */}
          {isSending && (
            <div className="mr-auto flex max-w-xl animate-pulse gap-3">
              <div className="bg-primary text-on-primary flex h-8 w-8 shrink-0 items-center justify-center rounded-xl">
                <Bot className="h-4 w-4" />
              </div>
              <div className="bg-surface-hover border-border text-12 text-text-secondary flex items-center gap-2 rounded-2xl rounded-tl-none border px-4 py-3">
                <Clock className="text-info-text h-3.5 w-3.5 animate-spin" />
                <span>Processando resposta com credenciais BYOK...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input box */}
        <form
          onSubmit={handleSendMessage}
          className="border-border bg-surface-card flex items-center gap-3 border-t p-4"
        >
          <input
            type="text"
            value={promptInput}
            onChange={(e) => setPromptInput(e.target.value)}
            disabled={isSending}
            placeholder="Digite uma mensagem para o agente de IA..."
            className="border-border-strong bg-surface-sidebar text-12 text-text placeholder-text-secondary focus:ring-focus-ring flex-1 rounded-xl border px-4 py-2.5 focus:ring-2 focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isSending || !promptInput.trim()}
            className="bg-primary text-12 text-on-primary hover:bg-primary-hover flex items-center gap-1.5 rounded-xl px-4 py-2.5 font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send className="h-3.5 w-3.5" />
            <span>Enviar</span>
          </button>
        </form>
      </main>

      {/* Modal: Create Agent Config */}
      {isModalOpen && (
        <div className="bg-overlay fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-surface-card border-card-border w-full max-w-lg rounded-2xl border p-6 shadow-xl">
            <div className="border-border flex items-center justify-between border-b pb-4">
              <div className="flex items-center gap-2">
                <div className="bg-info-bg text-info-text rounded-xl p-2">
                  <Settings className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-14 text-text font-bold">
                    Cadastrar Persona do Agente
                  </h3>
                  <p className="text-12 text-text-secondary">
                    Configure a persona, o prompt de sistema e a estratégia de
                    redundância.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-text-tertiary hover:text-text-subtle text-14 font-bold"
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={handleCreateAgent}
              className="text-12 mt-4 space-y-4"
            >
              <div>
                <label className="text-text-subtle mb-1 block font-semibold">
                  Nome do Agente
                </label>
                <input
                  type="text"
                  required
                  value={newAgentName}
                  onChange={(e) => setNewAgentName(e.target.value)}
                  placeholder="Ex: Suporte N2 ou Especialista em Redação"
                  className="border-border-strong text-12 focus:ring-focus-ring w-full rounded-xl border px-3 py-2 focus:ring-2 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-text-subtle mb-1 block font-semibold">
                  Descrição (Opcional)
                </label>
                <input
                  type="text"
                  value={newAgentDesc}
                  onChange={(e) => setNewAgentDesc(e.target.value)}
                  placeholder="Ex: Atende solicitações de suporte e triagem"
                  className="border-border-strong text-12 focus:ring-focus-ring w-full rounded-xl border px-3 py-2 focus:ring-2 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-text-subtle mb-1 block font-semibold">
                  Prompt de Sistema
                </label>
                <textarea
                  rows={3}
                  required
                  value={newAgentSystemPrompt}
                  onChange={(e) => setNewAgentSystemPrompt(e.target.value)}
                  placeholder="Instruções e diretrizes de comportamento do agente..."
                  className="border-border-strong text-12 focus:ring-focus-ring w-full rounded-xl border px-3 py-2 focus:ring-2 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-text-subtle mb-1 block font-semibold">
                    Provedor Primário
                  </label>
                  <select
                    value={newPrimaryProvider}
                    onChange={(e) =>
                      setNewPrimaryProvider(e.target.value as AIProvider)
                    }
                    className="border-border-strong text-12 focus:ring-focus-ring w-full rounded-xl border px-3 py-2 focus:ring-2 focus:outline-none"
                  >
                    <option value="openai">OpenAI</option>
                    <option value="gemini">Google Gemini</option>
                    <option value="anthropic">Anthropic</option>
                  </select>
                </div>

                <div>
                  <label className="text-text-subtle mb-1 block font-semibold">
                    Modelo Primário
                  </label>
                  <input
                    type="text"
                    required
                    value={newPrimaryModel}
                    onChange={(e) => setNewPrimaryModel(e.target.value)}
                    placeholder="gpt-4o-mini"
                    className="border-border-strong text-12 focus:ring-focus-ring w-full rounded-xl border px-3 py-2 focus:ring-2 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-text-subtle mb-1 block font-semibold">
                    Provedor Fallback (Opcional)
                  </label>
                  <select
                    value={newFallbackProvider}
                    onChange={(e) =>
                      setNewFallbackProvider(e.target.value as AIProvider | "")
                    }
                    className="border-border-strong text-12 focus:ring-focus-ring w-full rounded-xl border px-3 py-2 focus:ring-2 focus:outline-none"
                  >
                    <option value="">Nenhum (Sem redundância)</option>
                    <option value="gemini">Google Gemini</option>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                  </select>
                </div>

                <div>
                  <label className="text-text-subtle mb-1 block font-semibold">
                    Modelo Fallback
                  </label>
                  <input
                    type="text"
                    value={newFallbackModel}
                    onChange={(e) => setNewFallbackModel(e.target.value)}
                    placeholder="gemini-2.5-flash"
                    className="border-border-strong text-12 focus:ring-focus-ring w-full rounded-xl border px-3 py-2 focus:ring-2 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-text-subtle font-semibold">
                    Temperatura ({newTemperature})
                  </label>
                  <span className="text-10 text-text-tertiary">
                    0 = Preciso | 1 = Criativo
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={newTemperature}
                  onChange={(e) =>
                    setNewTemperature(parseFloat(e.target.value))
                  }
                  className="w-full"
                />
              </div>

              <div className="border-border flex justify-end gap-2 border-t pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="border-border-strong text-text-subtle hover:bg-surface-hover rounded-xl border px-4 py-2 font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isCreatingConfig}
                  className="bg-primary text-on-primary hover:bg-primary-hover rounded-xl px-4 py-2 font-semibold disabled:opacity-50"
                >
                  {isCreatingConfig ? "Salvando..." : "Criar Agente"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
