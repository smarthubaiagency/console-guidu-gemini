/**
 * ============================================================================
 * File: src/core/agents/providers/executor.ts
 * Module: AI Provider Execution Adapters & Network Dispatcher
 *
 * Maintenance Rationale:
 * - Direct HTTP clients for OpenAI, Google Gemini and Anthropic.
 * - Receives decrypted API key in memory on the server only.
 * - Normalizes request/response formats and captures execution latency.
 * - Throws descriptive errors on network/provider failures to allow automatic
 *   fallback execution by the prompt engine.
 * ============================================================================
 */

import type { AIProvider } from "@/core/credentials/vault";

export type ExecutionResult = {
  reply: string;
  tokensEstimated: number;
  latencyMs: number;
};

export type ExecutionParams = {
  provider: AIProvider;
  model: string;
  apiKey: string;
  systemPrompt?: string;
  prompt: string;
  temperature?: number;
};

/**
 * Dispatches a prompt to OpenAI's Chat Completions API.
 */
async function executeOpenAI(
  model: string,
  apiKey: string,
  systemPrompt: string | undefined,
  prompt: string,
  temperature: number,
): Promise<{ reply: string; tokensEstimated: number }> {
  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || "gpt-4o-mini",
      messages,
      temperature,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenAI API error [${response.status}]: ${errorBody}`);
  }

  const data = await response.json();
  const reply = data.choices?.[0]?.message?.content ?? "";
  const tokens = data.usage?.total_tokens ?? Math.ceil((prompt.length + reply.length) / 4);

  return { reply, tokensEstimated: tokens };
}

/**
 * Dispatches a prompt to Google Gemini API (v1beta generateContent).
 */
async function executeGemini(
  model: string,
  apiKey: string,
  systemPrompt: string | undefined,
  prompt: string,
  temperature: number,
): Promise<{ reply: string; tokensEstimated: number }> {
  const modelName = model || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  const body: {
    contents: Array<{ role: string; parts: Array<{ text: string }> }>;
    systemInstruction?: { parts: Array<{ text: string }> };
    generationConfig: { temperature: number };
  } = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature },
  };

  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini API error [${response.status}]: ${errorBody}`);
  }

  const data = await response.json();
  const reply =
    data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const tokens =
    data.usageMetadata?.totalTokenCount ?? Math.ceil((prompt.length + reply.length) / 4);

  return { reply, tokensEstimated: tokens };
}

/**
 * Dispatches a prompt to Anthropic Claude Messages API.
 */
async function executeAnthropic(
  model: string,
  apiKey: string,
  systemPrompt: string | undefined,
  prompt: string,
  temperature: number,
): Promise<{ reply: string; tokensEstimated: number }> {
  const modelName = model || "claude-3-5-sonnet-latest";

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelName,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1024,
      temperature,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Anthropic API error [${response.status}]: ${errorBody}`);
  }

  const data = await response.json();
  const reply = data.content?.[0]?.text ?? "";
  const tokens =
    (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0) ||
    Math.ceil((prompt.length + reply.length) / 4);

  return { reply, tokensEstimated: tokens };
}

/**
 * Unified execution dispatcher with latency timer.
 */
export async function executeProviderPrompt(
  params: ExecutionParams,
): Promise<ExecutionResult> {
  const { provider, model, apiKey, systemPrompt, prompt, temperature = 0.7 } = params;
  const start = Date.now();

  let res: { reply: string; tokensEstimated: number };

  switch (provider) {
    case "openai":
      res = await executeOpenAI(model, apiKey, systemPrompt, prompt, temperature);
      break;
    case "gemini":
      res = await executeGemini(model, apiKey, systemPrompt, prompt, temperature);
      break;
    case "anthropic":
      res = await executeAnthropic(model, apiKey, systemPrompt, prompt, temperature);
      break;
    default:
      throw new Error(`Unsupported AI provider: ${provider}`);
  }

  const latencyMs = Date.now() - start;

  return {
    reply: res.reply,
    tokensEstimated: res.tokensEstimated,
    latencyMs,
  };
}
