/**
 * ============================================================================
 * File: src/shared/errors/redact.ts
 * Module: Security Redaction Helper (AC07 & Spec §15, §16)
 *
 * Maintenance Rationale:
 * - Redacts sensitive tokens, API keys, JWTs, and passwords from logs and messages.
 * - Targets specific patterns: `sk-ant-`, `sk-`, `AIza`, `gdu_live_`, `eyJ`,
 *   URLs containing passwords, and full email addresses.
 * ============================================================================
 */

export function redact(input: string): string {
  if (!input) return "";

  let result = input;

  // 1. Anthropic API keys: sk-ant-...
  result = result.replace(/sk-ant-[a-zA-Z0-9_-]+/g, "sk-ant-[REDACTED]");

  // 2. OpenAI API keys: sk-... (excluding sk-ant-)
  result = result.replace(/sk-(?!ant-)[a-zA-Z0-9_-]+/g, "sk-[REDACTED]");

  // 3. Google Gemini API keys: AIza...
  result = result.replace(/AIza[a-zA-Z0-9_-]+/g, "AIza[REDACTED]");

  // 4. Platform API keys: gdu_live_...
  result = result.replace(/gdu_live_[a-zA-Z0-9_-]+/g, "gdu_live_[REDACTED]");

  // 5. JWT tokens: eyJ...
  result = result.replace(
    /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
    "eyJ[REDACTED]",
  );

  // 6. URLs with credentials: protocol://user:password@host...
  result = result.replace(
    /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/:]+):([^@/]+)(@\S+)/g,
    "$1:[REDACTED]$3",
  );

  // 7. Full email addresses: mask local-part before @ (e.g. u***@domain.com)
  result = result.replace(
    /([a-zA-Z0-9._%+-])[a-zA-Z0-9._%+-]*@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
    "$1***@$2",
  );

  return result;
}

export function redactData<T>(data: T): T {
  if (typeof data === "string") {
    return redact(data) as unknown as T;
  }
  if (Array.isArray(data)) {
    return data.map((item) => redactData(item)) as unknown as T;
  }
  if (data !== null && typeof data === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = redactData(value);
    }
    return result as unknown as T;
  }
  return data;
}
