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
  const [feedback, setFeedback] = useState<{ error?: string; success?: string } | null>(null);

  // Modal create agent state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCreatingConfig, startCreateTransition] = useTransition();
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentDesc, setNewAgentDesc] = useState("");
  const [newAgentSystemPrompt, setNewAgentSystemPrompt] = useState(
    "Você é um assistente especialista da plataforma GUIDU. Auxilie o usuário de forma clara e contextual.",
  );
  const [newPrimaryProvider, setNewPrimaryProvider] = useState<AIProvider>("openai");
  const [newPrimaryModel, setNewPrimaryModel] = useState("gpt-4o-mini");
  const [newFallbackProvider, setNewFallbackProvider] = useState<AIProvider | "">("gemini");
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
        setMessages((prev) => prev.filter((m) => m.id !== optimisticUserMsg.id));
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
    } catch (err: unknown) {
      setFeedback({ error: err instanceof Error ? err.message : String(err) });
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
      if (newFallbackProvider) formData.append("fallbackProvider", newFallbackProvider);
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
        setFeedback({ success: `Agente "${res.config.name}" criado com sucesso!` });
      }
    });
  };

  const activeConfig = configs.find((c) => c.id === selectedConfigId);

  return (
    <div className="flex flex-col lg:flex-row gap-6 h-[calc(100vh-12rem)] min-h-[600px]">
      {/* Sidebar: Sessions & Persona switcher */}
      <aside className="w-full lg:w-80 flex flex-col gap-4 border border-neutral-200 rounded-2xl bg-white p-4 shadow-sm">
        {/* Active persona picker */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-neutral-600 flex items-center gap-1.5">
              <Cpu className="h-3.5 w-3.5 text-neutral-500" />
              Persona do Agente
            </label>
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
            >
              <Plus className="h-3 w-3" />
              Novo
            </button>
          </div>

          <select
            value={selectedConfigId}
            onChange={(e) => setSelectedConfigId(e.target.value)}
            className="w-full rounded-xl border border-neutral-300 bg-neutral-50/50 px-3 py-2 text-xs font-medium text-neutral-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {configs.length === 0 && (
              <option value="">Guidu Assistant (Padrão)</option>
            )}
            {configs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.primaryProvider})
              </option>
            ))}
          </select>

          {activeConfig && (
            <div className="mt-2 p-2.5 rounded-xl bg-neutral-50 border border-neutral-200 text-xs text-neutral-600 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-neutral-800">{activeConfig.name}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-mono">
                  {activeConfig.primaryProvider}:{activeConfig.primaryModel}
                </span>
              </div>
              {activeConfig.description && (
                <p className="text-[11px] text-neutral-500 line-clamp-1">
                  {activeConfig.description}
                </p>
              )}
              {activeConfig.fallbackProvider && (
                <div className="flex items-center gap-1 text-[10px] text-amber-700 font-medium pt-0.5">
                  <Layers className="h-3 w-3" />
                  <span>Fallback: {activeConfig.fallbackProvider}:{activeConfig.fallbackModel}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* New chat button */}
        <button
          type="button"
          onClick={handleStartNewChat}
          className="flex items-center justify-center gap-2 w-full rounded-xl bg-neutral-900 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-neutral-800 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Nova Conversa
        </button>

        {/* Chat History List */}
        <div className="flex-1 overflow-y-auto space-y-1 pr-1">
          <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider px-2 py-1">
            Histórico Recente
          </div>
          {sessions.length === 0 ? (
            <div className="text-center py-6 text-xs text-neutral-400">
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
                  className={`w-full text-left px-3 py-2.5 rounded-xl text-xs flex items-center gap-2.5 transition-colors ${
                    isSelected
                      ? "bg-blue-50 text-blue-900 font-medium border border-blue-200"
                      : "text-neutral-700 hover:bg-neutral-100/70"
                  }`}
                >
                  <MessageSquare className={`h-3.5 w-3.5 shrink-0 ${isSelected ? "text-blue-600" : "text-neutral-400"}`} />
                  <span className="truncate flex-1">{s.title}</span>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* Main Chat Panel */}
      <main className="flex-1 flex flex-col border border-neutral-200 rounded-2xl bg-white shadow-sm overflow-hidden">
        {/* Chat Top Banner */}
        <div className="border-b border-neutral-200 px-6 py-4 flex items-center justify-between bg-neutral-50/70">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-neutral-900 flex items-center gap-2">
                <span>{activeConfig ? activeConfig.name : "Guidu Assistant"}</span>
                <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                  Online
                </span>
              </div>
              <p className="text-xs text-neutral-500">
                {activeConfig?.description || "Assistente inteligente com suporte a chaves BYOK e fallbacks"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-neutral-500">
            <span className="hidden sm:inline">Motor resiliente:</span>
            <span className="px-2 py-1 rounded bg-neutral-200/70 font-mono text-[11px] text-neutral-700">
              {activeConfig?.primaryProvider || "BYOK"}
            </span>
          </div>
        </div>

        {/* Feedback message */}
        {feedback?.error && (
          <div className="m-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 animate-in fade-in">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
            <span className="flex-1">{feedback.error}</span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-red-400 hover:text-red-600"
            >
              ×
            </button>
          </div>
        )}

        {feedback?.success && (
          <div className="m-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700 animate-in fade-in">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span className="flex-1">{feedback.success}</span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-emerald-400 hover:text-emerald-600"
            >
              ×
            </button>
          </div>
        )}

        {/* Messages Stream */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {isLoadingMessages ? (
            <div className="flex items-center justify-center h-full text-xs text-neutral-400 gap-2">
              <Clock className="h-4 w-4 animate-spin" />
              Carregando histórico da conversa...
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-sm mx-auto space-y-3">
              <div className="h-12 w-12 rounded-2xl bg-neutral-100 flex items-center justify-center text-neutral-400">
                <Sparkles className="h-6 w-6 text-neutral-500" />
              </div>
              <h3 className="text-sm font-semibold text-neutral-800">
                Inicie uma nova interação
              </h3>
              <p className="text-xs text-neutral-500 leading-relaxed">
                Envie perguntas, solicitações de geração ou comandos de automação. As consultas serão executadas pelo provedor primário com redundância automática.
              </p>
            </div>
          ) : (
            messages.map((m) => {
              const isUser = m.role === "user";
              return (
                <div
                  key={m.id}
                  className={`flex gap-3 max-w-2xl ${
                    isUser ? "ml-auto flex-row-reverse" : "mr-auto"
                  }`}
                >
                  <div
                    className={`h-8 w-8 rounded-xl shrink-0 flex items-center justify-center text-xs ${
                      isUser
                        ? "bg-neutral-900 text-white"
                        : "bg-blue-600 text-white"
                    }`}
                  >
                    {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                  </div>

                  <div className="space-y-1.5 flex flex-col">
                    <div
                      className={`rounded-2xl px-4 py-3 text-xs leading-relaxed whitespace-pre-wrap ${
                        isUser
                          ? "bg-neutral-900 text-white rounded-tr-none"
                          : "bg-neutral-100 text-neutral-900 rounded-tl-none border border-neutral-200"
                      }`}
                    >
                      {m.content}
                    </div>

                    {/* Metadata tags for assistant messages */}
                    {!isUser && (
                      <div className="flex flex-wrap items-center gap-2 text-[10px] text-neutral-500 px-1">
                        {m.fallbackTriggered && (
                          <span className="flex items-center gap-1 font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
                            <AlertTriangle className="h-3 w-3 text-amber-600" />
                            Fallback Acionado
                          </span>
                        )}
                        <span className="font-mono bg-neutral-100 border border-neutral-200 px-1.5 py-0.5 rounded text-neutral-700">
                          {m.providerUsed}:{m.modelUsed}
                        </span>
                        {m.latencyMs > 0 && (
                          <span className="flex items-center gap-1 text-neutral-500">
                            <Clock className="h-3 w-3" />
                            {m.latencyMs} ms
                          </span>
                        )}
                        {m.tokensEstimated > 0 && (
                          <span className="flex items-center gap-1 text-neutral-500">
                            <Coins className="h-3 w-3" />
                            ~{m.tokensEstimated} tokens
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
            <div className="flex gap-3 max-w-xl mr-auto animate-pulse">
              <div className="h-8 w-8 rounded-xl shrink-0 bg-blue-600 text-white flex items-center justify-center">
                <Bot className="h-4 w-4" />
              </div>
              <div className="rounded-2xl rounded-tl-none bg-neutral-100 border border-neutral-200 px-4 py-3 text-xs text-neutral-500 flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 animate-spin text-blue-600" />
                <span>Processando resposta com credenciais BYOK...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input box */}
        <form
          onSubmit={handleSendMessage}
          className="border-t border-neutral-200 p-4 bg-white flex items-center gap-3"
        >
          <input
            type="text"
            value={promptInput}
            onChange={(e) => setPromptInput(e.target.value)}
            disabled={isSending}
            placeholder="Digite uma mensagem para o agente de IA..."
            className="flex-1 rounded-xl border border-neutral-300 bg-neutral-50/50 px-4 py-2.5 text-xs text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isSending || !promptInput.trim()}
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            <Send className="h-3.5 w-3.5" />
            <span>Enviar</span>
          </button>
        </form>
      </main>

      {/* Modal: Create Agent Config */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-neutral-200 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-4 border-b border-neutral-100">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-blue-50 text-blue-700">
                  <Settings className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-neutral-900">
                    Cadastrar Persona do Agente
                  </h3>
                  <p className="text-xs text-neutral-500">
                    Configure a persona, o prompt de sistema e a estratégia de redundância.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-neutral-400 hover:text-neutral-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateAgent} className="mt-4 space-y-4 text-xs">
              <div>
                <label className="font-semibold text-neutral-700 block mb-1">
                  Nome do Agente
                </label>
                <input
                  type="text"
                  required
                  value={newAgentName}
                  onChange={(e) => setNewAgentName(e.target.value)}
                  placeholder="Ex: Suporte N2 ou Especialista em Redação"
                  className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="font-semibold text-neutral-700 block mb-1">
                  Descrição (Opcional)
                </label>
                <input
                  type="text"
                  value={newAgentDesc}
                  onChange={(e) => setNewAgentDesc(e.target.value)}
                  placeholder="Ex: Atende solicitações de suporte e triagem"
                  className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="font-semibold text-neutral-700 block mb-1">
                  Prompt de Sistema
                </label>
                <textarea
                  rows={3}
                  required
                  value={newAgentSystemPrompt}
                  onChange={(e) => setNewAgentSystemPrompt(e.target.value)}
                  placeholder="Instruções e diretrizes de comportamento do agente..."
                  className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-neutral-700 block mb-1">
                    Provedor Primário
                  </label>
                  <select
                    value={newPrimaryProvider}
                    onChange={(e) => setNewPrimaryProvider(e.target.value as AIProvider)}
                    className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="openai">OpenAI</option>
                    <option value="gemini">Google Gemini</option>
                    <option value="anthropic">Anthropic</option>
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-neutral-700 block mb-1">
                    Modelo Primário
                  </label>
                  <input
                    type="text"
                    required
                    value={newPrimaryModel}
                    onChange={(e) => setNewPrimaryModel(e.target.value)}
                    placeholder="gpt-4o-mini"
                    className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-neutral-700 block mb-1">
                    Provedor Fallback (Opcional)
                  </label>
                  <select
                    value={newFallbackProvider}
                    onChange={(e) => setNewFallbackProvider(e.target.value as AIProvider | "")}
                    className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Nenhum (Sem redundância)</option>
                    <option value="gemini">Google Gemini</option>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-neutral-700 block mb-1">
                    Modelo Fallback
                  </label>
                  <input
                    type="text"
                    value={newFallbackModel}
                    onChange={(e) => setNewFallbackModel(e.target.value)}
                    placeholder="gemini-2.5-flash"
                    className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="font-semibold text-neutral-700">
                    Temperatura ({newTemperature})
                  </label>
                  <span className="text-[10px] text-neutral-400">0 = Preciso | 1 = Criativo</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={newTemperature}
                  onChange={(e) => setNewTemperature(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-xl border border-neutral-300 px-4 py-2 font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isCreatingConfig}
                  className="rounded-xl bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
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
