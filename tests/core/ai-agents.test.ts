/**
 * ============================================================================
 * File: tests/core/ai-agents.test.ts
 * Module: Task 07 - AI Prompt & Agent Engine Integration Test Suite
 *
 * Maintenance Rationale:
 * - Validates SMA-100 & Spec §16:
 *   - Agent persona creation and listing inside `withContext`.
 *   - Prompt execution with primary BYOK credentials.
 *   - Automatic resilient fallback when primary provider fails.
 *   - Session and message audit trail recording (latencies, tokens, fallback flag).
 *   - Multi-tenant tenant boundary isolation (AC01): Workspace B cannot reach Workspace A agent data.
 * ============================================================================
 */

import { PrismaClient } from "@prisma/client";
import { expect, it, beforeEach, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { registerCredential } from "@/core/credentials/vault";
import { ModuleUnavailableError } from "@/core/modules/availability";
import {
  createAgentConfig,
  listAgentConfigs,
  getAgentConfig,
  createAgentSession,
  listAgentSessions,
  getSessionWithMessages,
  executeAgentPrompt,
  AgentExecutionError,
} from "@/core/agents/engine";
import type { ExecutionParams, ExecutionResult } from "@/core/agents/providers/executor";
import { withContext } from "@/lib/prisma/with-context";
import { contextA, contextB } from "./fixtures";
import { describeDatabase } from "../prisma-rls/describe-database.js";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const requiredVars = { DATABASE_URL: databaseUrl };

describeDatabase("Task 07: AI Agent Engine, Fallback Resilience & Interaction History", requiredVars, () => {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url:
          process.env.DIRECT_DATABASE_URL ??
          process.env.DATABASE_URL ??
          "",
      },
    },
  });

  const cleanup = async () => {
    await withContext(prisma, contextA, async (tx) => {
      await tx.credential.deleteMany({
        where: { workspaceId: contextA.workspaceId },
      });
      await tx.agentSession.deleteMany({
        where: { workspaceId: contextA.workspaceId },
      });
      await tx.agentConfig.deleteMany({
        where: { workspaceId: contextA.workspaceId },
      });
    });
  };

  beforeEach(async () => {
    vi.stubEnv("GUIDU_MODULE_AI_AGENTS_ENABLED", "true");
    await cleanup();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await cleanup();
  });

  it("creates and lists agent configurations scoped to workspace", async () => {
    await withContext(prisma, contextA, async (tx) => {
      const config = await createAgentConfig(tx, {
        organizationId: contextA.organizationId,
        workspaceId: contextA.workspaceId,
        name: "Test Support Bot",
        description: "Bot de testes para atendimento",
        systemPrompt: "Você é um assistente de suporte.",
        primaryProvider: "openai",
        primaryModel: "gpt-4o-mini",
        fallbackProvider: "gemini",
        fallbackModel: "gemini-2.5-flash",
        temperature: 0.5,
      });

      expect(config.id).toBeDefined();
      expect(config.name).toBe("Test Support Bot");
      expect(config.primaryProvider).toBe("openai");
      expect(config.fallbackProvider).toBe("gemini");
      expect(config.temperature).toBe(0.5);

      const configs = await listAgentConfigs(tx, contextA.workspaceId);
      expect(configs.some((c) => c.id === config.id)).toBe(true);

      const fetched = await getAgentConfig(tx, config.id);
      expect(fetched?.name).toBe("Test Support Bot");
    });
  });

  it("executes prompt using primary provider when successful", async () => {
    await withContext(prisma, contextA, async (tx) => {
      // Register credentials for primary provider
      await registerCredential(tx, contextA, {
        provider: "openai",
        label: "OpenAI Primary Key",
        secret: "sk-proj-valid-test-key-1234567890",
      });

      const config = await createAgentConfig(tx, {
        organizationId: contextA.organizationId,
        workspaceId: contextA.workspaceId,
        name: "Prompt Runner Bot",
        systemPrompt: "Seja conciso.",
        primaryProvider: "openai",
        primaryModel: "gpt-4o-mini",
      });

      // Mock executor
      const mockExecutor = async (params: ExecutionParams): Promise<ExecutionResult> => {
        expect(params.provider).toBe("openai");
        expect(params.model).toBe("gpt-4o-mini");
        expect(params.apiKey).toBe("sk-proj-valid-test-key-1234567890");
        return {
          reply: "Resposta simulada da OpenAI",
          tokensEstimated: 42,
          latencyMs: 150,
        };
      };

      const result = await executeAgentPrompt(
        tx,
        {
          workspaceId: contextA.workspaceId,
          organizationId: contextA.organizationId,
          userId: contextA.userId,
          prompt: "Olá, como você funciona?",
          agentConfigId: config.id,
        },
        mockExecutor,
      );

      expect(result.reply).toBe("Resposta simulada da OpenAI");
      expect(result.fallbackTriggered).toBe(false);
      expect(result.providerUsed).toBe("openai");
      expect(result.modelUsed).toBe("gpt-4o-mini");
      expect(result.latencyMs).toBe(150);
      expect(result.tokensEstimated).toBe(42);

      // Verify session and message persistence
      expect(result.session.id).toBeDefined();
      expect(result.userMessage.content).toBe("Olá, como você funciona?");
      expect(result.assistantMessage.content).toBe("Resposta simulada da OpenAI");
    });
  });

  it("transparently triggers fallback provider when primary provider fails", async () => {
    await withContext(prisma, contextA, async (tx) => {
      // Register keys for both primary and fallback
      await registerCredential(tx, contextA, {
        provider: "openai",
        label: "OpenAI Broken Key",
        secret: "sk-proj-failing-primary-key-1234567890",
      });

      await registerCredential(tx, contextA, {
        provider: "gemini",
        label: "Gemini Fallback Key",
        secret: "AIzaSy-fallback-working-key-1234567890",
      });

      const config = await createAgentConfig(tx, {
        organizationId: contextA.organizationId,
        workspaceId: contextA.workspaceId,
        name: "Resilient Agent",
        systemPrompt: "Você é um assistente redundante.",
        primaryProvider: "openai",
        primaryModel: "gpt-4o",
        fallbackProvider: "gemini",
        fallbackModel: "gemini-2.5-flash",
      });

      // Mock executor that fails on OpenAI but succeeds on Gemini
      const mockExecutor = async (params: ExecutionParams): Promise<ExecutionResult> => {
        if (params.provider === "openai") {
          throw new Error("OpenAI API 429 Too Many Requests: Quota exceeded");
        }
        if (params.provider === "gemini") {
          expect(params.apiKey).toBe("AIzaSy-fallback-working-key-1234567890");
          return {
            reply: "Resposta recuperada via Gemini com sucesso!",
            tokensEstimated: 60,
            latencyMs: 220,
          };
        }
        throw new Error("Unexpected provider");
      };

      const result = await executeAgentPrompt(
        tx,
        {
          workspaceId: contextA.workspaceId,
          organizationId: contextA.organizationId,
          userId: contextA.userId,
          prompt: "Pergunta crítica que precisa de resposta resiliente",
          agentConfigId: config.id,
        },
        mockExecutor,
      );

      // Verification of automated fallback
      expect(result.fallbackTriggered).toBe(true);
      expect(result.providerUsed).toBe("gemini");
      expect(result.modelUsed).toBe("gemini-2.5-flash");
      expect(result.reply).toBe("Resposta recuperada via Gemini com sucesso!");
      expect(result.assistantMessage.fallbackTriggered).toBe(true);
    });
  });

  it("throws descriptive AgentExecutionError when both primary and fallback fail", async () => {
    await withContext(prisma, contextA, async (tx) => {
      await registerCredential(tx, contextA, {
        provider: "openai",
        label: "Broken Key 1",
        secret: "sk-proj-fail1-1234567890",
      });

      await registerCredential(tx, contextA, {
        provider: "gemini",
        label: "Broken Key 2",
        secret: "AIzaSy-fail2-1234567890",
      });

      const config = await createAgentConfig(tx, {
        organizationId: contextA.organizationId,
        workspaceId: contextA.workspaceId,
        name: "Double Failure Bot",
        systemPrompt: "Test",
        primaryProvider: "openai",
        primaryModel: "gpt-4o",
        fallbackProvider: "gemini",
        fallbackModel: "gemini-2.5-flash",
      });

      const failingExecutor = async (): Promise<ExecutionResult> => {
        throw new Error("Simulated network disconnection");
      };

      await expect(
        executeAgentPrompt(
          tx,
          {
            workspaceId: contextA.workspaceId,
            organizationId: contextA.organizationId,
            userId: contextA.userId,
            prompt: "Test prompt",
            agentConfigId: config.id,
          },
          failingExecutor,
        ),
      ).rejects.toThrow(AgentExecutionError);
    });
  });

  it("maintains conversation history across multiple turns in the same session", async () => {
    await withContext(prisma, contextA, async (tx) => {
      await registerCredential(tx, contextA, {
        provider: "anthropic",
        label: "Anthropic Key",
        secret: "sk-ant-multi-turn-key-1234567890",
      });

      const config = await createAgentConfig(tx, {
        organizationId: contextA.organizationId,
        workspaceId: contextA.workspaceId,
        name: "Turn Agent",
        systemPrompt: "Multi turn test",
        primaryProvider: "anthropic",
        primaryModel: "claude-3-5-sonnet-latest",
      });

      let turnCount = 0;
      const turnExecutor = async (): Promise<ExecutionResult> => {
        turnCount++;
        return {
          reply: `Resposta do Turno ${turnCount}`,
          tokensEstimated: 30,
          latencyMs: 100,
        };
      };

      // First turn: generates new session
      const turn1 = await executeAgentPrompt(
        tx,
        {
          workspaceId: contextA.workspaceId,
          organizationId: contextA.organizationId,
          userId: contextA.userId,
          prompt: "Turno 1: Qual é o seu nome?",
          agentConfigId: config.id,
        },
        turnExecutor,
      );

      const sessionId = turn1.session.id;

      // Second turn: supplies sessionId
      const turn2 = await executeAgentPrompt(
        tx,
        {
          workspaceId: contextA.workspaceId,
          organizationId: contextA.organizationId,
          userId: contextA.userId,
          prompt: "Turno 2: E o que você faz?",
          agentConfigId: config.id,
          sessionId,
        },
        turnExecutor,
      );

      expect(turn2.session.id).toBe(sessionId);

      // Verify conversation history order
      const history = await getSessionWithMessages(tx, sessionId);
      expect(history.session).not.toBeNull();
      expect(history.messages.length).toBe(4); // 2 user + 2 assistant
      expect(history.messages[0]?.role).toBe("user");
      expect(history.messages[0]?.content).toBe("Turno 1: Qual é o seu nome?");
      expect(history.messages[1]?.role).toBe("assistant");
      expect(history.messages[1]?.content).toBe("Resposta do Turno 1");
      expect(history.messages[2]?.role).toBe("user");
      expect(history.messages[2]?.content).toBe("Turno 2: E o que você faz?");
      expect(history.messages[3]?.role).toBe("assistant");
      expect(history.messages[3]?.content).toBe("Resposta do Turno 2");
    });
  });

  it("enforces cross-workspace tenant isolation (AC01)", async () => {
    // 1. Create agent and session in Workspace A
    let sessionAId = "";
    let configAId = "";

    await withContext(prisma, contextA, async (tx) => {
      const configA = await createAgentConfig(tx, {
        organizationId: contextA.organizationId,
        workspaceId: contextA.workspaceId,
        name: "Private Workspace A Agent",
        systemPrompt: "Restricted",
        primaryProvider: "openai",
        primaryModel: "gpt-4o-mini",
      });
      configAId = configA.id;

      const sessionA = await createAgentSession(tx, {
        organizationId: contextA.organizationId,
        workspaceId: contextA.workspaceId,
        createdByUserId: contextA.userId,
        agentConfigId: configA.id,
        title: "Sessão Exclusiva A",
      });
      sessionAId = sessionA.id;
    });

    // 2. Query from Workspace B: agent and session must NOT be visible or accessible
    await withContext(prisma, contextB, async (tx) => {
      const bConfigs = await listAgentConfigs(tx, contextB.workspaceId);
      expect(bConfigs.some((c) => c.id === configAId)).toBe(false);

      const bSessions = await listAgentSessions(tx, contextB.workspaceId);
      expect(bSessions.some((s) => s.id === sessionAId)).toBe(false);

      // Attempting to load Session A from context B returns null/empty
      const bHistory = await getSessionWithMessages(tx, sessionAId);
      expect(bHistory.session).toBeNull();
      expect(bHistory.messages.length).toBe(0);
    });
  });

  it("blocks all engine operations when GUIDU_MODULE_AI_AGENTS_ENABLED is false without touching DB or executor", async () => {
    vi.stubEnv("GUIDU_MODULE_AI_AGENTS_ENABLED", "false");

    let executorCalled = false;
    const spyExecutor = async (): Promise<ExecutionResult> => {
      executorCalled = true;
      return { reply: "should not be called", tokensEstimated: 0, latencyMs: 0 };
    };

    await withContext(prisma, contextA, async (tx) => {
      // 1. createAgentConfig throws
      await expect(
        createAgentConfig(tx, {
          organizationId: contextA.organizationId,
          workspaceId: contextA.workspaceId,
          name: "Blocked Agent",
          systemPrompt: "Blocked",
          primaryProvider: "openai",
          primaryModel: "gpt-4o-mini",
        }),
      ).rejects.toThrow(ModuleUnavailableError);

      // 2. listAgentConfigs throws
      await expect(listAgentConfigs(tx, contextA.workspaceId)).rejects.toThrow(
        ModuleUnavailableError,
      );

      // 3. getAgentConfig throws
      await expect(getAgentConfig(tx, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(
        ModuleUnavailableError,
      );

      // 4. createAgentSession throws
      await expect(
        createAgentSession(tx, {
          organizationId: contextA.organizationId,
          workspaceId: contextA.workspaceId,
          createdByUserId: contextA.userId,
        }),
      ).rejects.toThrow(ModuleUnavailableError);

      // 5. listAgentSessions throws
      await expect(listAgentSessions(tx, contextA.workspaceId)).rejects.toThrow(
        ModuleUnavailableError,
      );

      // 6. getSessionWithMessages throws
      await expect(
        getSessionWithMessages(tx, "00000000-0000-0000-0000-000000000000"),
      ).rejects.toThrow(ModuleUnavailableError);

      // 7. executeAgentPrompt throws and executor is NOT called
      await expect(
        executeAgentPrompt(
          tx,
          {
            workspaceId: contextA.workspaceId,
            organizationId: contextA.organizationId,
            userId: contextA.userId,
            prompt: "Tentativa bloqueada",
          },
          spyExecutor,
        ),
      ).rejects.toThrow(ModuleUnavailableError);

      expect(executorCalled).toBe(false);

      // Verify no records were inserted into agent tables
      const countConfigs = await tx.agentConfig.count({
        where: { workspaceId: contextA.workspaceId },
      });
      const countSessions = await tx.agentSession.count({
        where: { workspaceId: contextA.workspaceId },
      });
      expect(countConfigs).toBe(0);
      expect(countSessions).toBe(0);
    });
  });

  it("throws actionable 'nenhum agente configurado' when prompt is dispatched without any registered agent", async () => {
    await withContext(prisma, contextA, async (tx) => {
      await registerCredential(tx, contextA, {
        provider: "openai",
        label: "OpenAI Valid Key",
        secret: "sk-proj-valid-test-key-1234567890",
      });

      const mockExecutor = async (): Promise<ExecutionResult> => ({
        reply: "should not run",
        tokensEstimated: 0,
        latencyMs: 0,
      });

      await expect(
        executeAgentPrompt(
          tx,
          {
            workspaceId: contextA.workspaceId,
            organizationId: contextA.organizationId,
            userId: contextA.userId,
            prompt: "Pergunta sem agente cadastrado",
          },
          mockExecutor,
        ),
      ).rejects.toThrow("nenhum agente configurado");
    });
  });
});
