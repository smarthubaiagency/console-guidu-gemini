import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { requireUser, resolveWorkspaceContext, withContext } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  resolveWorkspaceContext: vi.fn(),
  withContext: vi.fn(),
}));

vi.mock("@/core/auth/identity", () => ({ requireUser }));
vi.mock("@/core/auth/context", () => ({ resolveWorkspaceContext }));
vi.mock("@/lib/prisma/with-context", () => ({ withContext }));
vi.mock("@/lib/prisma/client", () => ({ prisma: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  executePromptAction,
  createAgentConfigAction,
  loadSessionMessagesAction,
} from "./actions";

function createFormData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

describe("AI Agents Server Actions - Availability Guard (C04)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("blocks executePromptAction when GUIDU_MODULE_AI_AGENTS_ENABLED is false", async () => {
    vi.stubEnv("GUIDU_MODULE_AI_AGENTS_ENABLED", "false");

    const result = await executePromptAction(
      {},
      createFormData({
        workspaceSlug: "ws-test",
        prompt: "Olá, agente de teste",
      }),
    );

    expect(result.success).toBeUndefined();
    expect(result.error).toContain("temporariamente indisponível");
    expect(requireUser).not.toHaveBeenCalled();
    expect(resolveWorkspaceContext).not.toHaveBeenCalled();
    expect(withContext).not.toHaveBeenCalled();
  });

  it("blocks createAgentConfigAction when GUIDU_MODULE_AI_AGENTS_ENABLED is false", async () => {
    vi.stubEnv("GUIDU_MODULE_AI_AGENTS_ENABLED", "false");

    const result = await createAgentConfigAction(
      {},
      createFormData({
        workspaceSlug: "ws-test",
        name: "Novo Agente",
        systemPrompt: "Instruções do sistema",
        primaryProvider: "openai",
        primaryModel: "gpt-4o",
      }),
    );

    expect(result.success).toBeUndefined();
    expect(result.error).toContain("temporariamente indisponível");
    expect(requireUser).not.toHaveBeenCalled();
    expect(resolveWorkspaceContext).not.toHaveBeenCalled();
    expect(withContext).not.toHaveBeenCalled();
  });

  it("blocks loadSessionMessagesAction when GUIDU_MODULE_AI_AGENTS_ENABLED is false", async () => {
    vi.stubEnv("GUIDU_MODULE_AI_AGENTS_ENABLED", "false");

    const result = await loadSessionMessagesAction(
      "ws-test",
      "00000000-0000-0000-0000-000000000000",
    );

    expect(result.session).toBeNull();
    expect(result.messages).toEqual([]);
    expect(result.error).toContain("temporariamente indisponível");
    expect(requireUser).not.toHaveBeenCalled();
    expect(resolveWorkspaceContext).not.toHaveBeenCalled();
    expect(withContext).not.toHaveBeenCalled();
  });
});
