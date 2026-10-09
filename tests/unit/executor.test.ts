import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  executeProviderPrompt,
  ProviderError,
} from "@/core/agents/providers/executor";

describe("AI Provider Network Dispatcher & Secret Security (C10, Spec §16, AC07)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("Google Gemini (Key Out of URL)", () => {
    it("sends API key via x-goog-api-key header and NEVER in query string (AC07)", async () => {
      const apiKey = "AIzaSyD_superSecretGeminiKey123456";
      let capturedUrl = "";
      let capturedHeaders: Record<string, string> = {};

      global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedHeaders = (init?.headers as Record<string, string>) ?? {};
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [{ text: "Hello from Gemini!" }],
                },
              },
            ],
            usageMetadata: { totalTokenCount: 42 },
          }),
        } as unknown as Response;
      });

      const result = await executeProviderPrompt({
        provider: "gemini",
        model: "gemini-2.5-flash",
        apiKey,
        prompt: "Say hello",
      });

      expect(result.reply).toBe("Hello from Gemini!");
      expect(result.tokensEstimated).toBe(42);

      // Verify URL does not contain ?key= or any query params or apiKey
      expect(capturedUrl).not.toContain("?key=");
      expect(capturedUrl).not.toContain(apiKey);
      expect(capturedUrl).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      );

      // Verify key is strictly in headers
      expect(capturedHeaders["x-goog-api-key"]).toBe(apiKey);
    });

    it("throws ProviderError on failure without leaking response body", async () => {
      const apiKey = "AIzaSyD_secretKey";
      const sensitiveResponseBody = JSON.stringify({
        error: {
          code: 403,
          message: "API key invalid or leaked in https://service?key=AIzaSyD_secretKey",
          status: "PERMISSION_DENIED",
        },
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => JSON.parse(sensitiveResponseBody),
        text: async () => sensitiveResponseBody,
      } as unknown as Response);

      await expect(
        executeProviderPrompt({
          provider: "gemini",
          model: "gemini-2.5-flash",
          apiKey,
          prompt: "Fail please",
        }),
      ).rejects.toThrowError(ProviderError);

      try {
        await executeProviderPrompt({
          provider: "gemini",
          model: "gemini-2.5-flash",
          apiKey,
          prompt: "Fail please",
        });
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderError);
        const provErr = err as ProviderError;
        expect(provErr.provider).toBe("gemini");
        expect(provErr.status).toBe(403);
        expect(provErr.message).toBe("AI provider gemini returned HTTP 403");
        expect(provErr.message).not.toContain(sensitiveResponseBody);
        expect(provErr.message).not.toContain(apiKey);
      }
    });
  });

  describe("OpenAI Dispatcher", () => {
    it("sends API key in Authorization: Bearer header", async () => {
      const apiKey = "sk-proj-superSecretOpenAIKey";
      let capturedHeaders: Record<string, string> = {};

      global.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        capturedHeaders = (init?.headers as Record<string, string>) ?? {};
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: "OpenAI response" } }],
            usage: { total_tokens: 25 },
          }),
        } as unknown as Response;
      });

      const result = await executeProviderPrompt({
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey,
        prompt: "OpenAI prompt",
      });

      expect(result.reply).toBe("OpenAI response");
      expect(capturedHeaders["Authorization"]).toBe(`Bearer ${apiKey}`);
    });

    it("throws ProviderError with status code only on non-ok response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ error: { message: "Rate limit exceeded" } }),
      } as unknown as Response);

      await expect(
        executeProviderPrompt({
          provider: "openai",
          model: "gpt-4o-mini",
          apiKey: "sk-test",
          prompt: "test",
        }),
      ).rejects.toThrowError("AI provider openai returned HTTP 429");
    });
  });

  describe("Anthropic Dispatcher", () => {
    it("sends API key in x-api-key header", async () => {
      const apiKey = "sk-ant-api03-superSecretAnthropicKey";
      let capturedHeaders: Record<string, string> = {};

      global.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        capturedHeaders = (init?.headers as Record<string, string>) ?? {};
        return {
          ok: true,
          status: 200,
          json: async () => ({
            content: [{ text: "Claude response" }],
            usage: { input_tokens: 10, output_tokens: 15 },
          }),
        } as unknown as Response;
      });

      const result = await executeProviderPrompt({
        provider: "anthropic",
        model: "claude-3-5-sonnet-latest",
        apiKey,
        prompt: "Claude prompt",
      });

      expect(result.reply).toBe("Claude response");
      expect(result.tokensEstimated).toBe(25);
      expect(capturedHeaders["x-api-key"]).toBe(apiKey);
    });

    it("throws ProviderError with status code only on non-ok response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: "Internal server error" } }),
      } as unknown as Response);

      await expect(
        executeProviderPrompt({
          provider: "anthropic",
          model: "claude-3-5-sonnet-latest",
          apiKey: "sk-ant-test",
          prompt: "test",
        }),
      ).rejects.toThrowError("AI provider anthropic returned HTTP 500");
    });
  });
});
