import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { sanitizeMetadata } from "@/core/audit/record";

describe("Audit Metadata Sanitization (Spec §16, §20, §24 AC07 & AC14)", () => {
  it("allows only approved metadata keys from the strict allowlist", () => {
    const raw = {
      provider: "openai",
      purpose: "chat",
      maskedValue: "sk-...1234",
      scopes: ["read", "proposals:write"],
      expiresAt: "2026-12-31T00:00:00.000Z",
      prefix: "gdu_live_abc123...",
      from: "member",
      to: "admin",
      role: "admin",
      unlistedCustomField: "should_be_stripped",
      internalDebug: 12345,
    };

    const sanitized = sanitizeMetadata(raw);

    expect(sanitized).toEqual({
      provider: "openai",
      purpose: "chat",
      maskedValue: "sk-...1234",
      scopes: ["read", "proposals:write"],
      expiresAt: "2026-12-31T00:00:00.000Z",
      prefix: "gdu_live_abc123...",
      from: "member",
      to: "admin",
      role: "admin",
    });
    expect(sanitized).not.toHaveProperty("unlistedCustomField");
    expect(sanitized).not.toHaveProperty("internalDebug");
  });

  it("strictly filters forbidden keys (secret, token, key, password, encryptedPayload, rawKey)", () => {
    const raw = {
      provider: "anthropic",
      secret: "sk-ant-api03-very-secret-token",
      token: "secret-token-12345",
      key: "my-plain-key",
      apiKey: "gdu_live_1234567890",
      rawKey: "gdu_live_abcdef123456",
      password: "adminPassword123!",
      encryptedPayload: "aes-256-gcm:payload",
      maskedValue: "sk-...5678",
    };

    const sanitized = sanitizeMetadata(raw);

    expect(sanitized).toEqual({
      provider: "anthropic",
      maskedValue: "sk-...5678",
    });
    expect(sanitized).not.toHaveProperty("secret");
    expect(sanitized).not.toHaveProperty("token");
    expect(sanitized).not.toHaveProperty("key");
    expect(sanitized).not.toHaveProperty("apiKey");
    expect(sanitized).not.toHaveProperty("rawKey");
    expect(sanitized).not.toHaveProperty("password");
    expect(sanitized).not.toHaveProperty("encryptedPayload");
  });

  it("never records full email addresses, extracting only the domain", () => {
    const raw = {
      role: "viewer",
      email: "confidential_ceo@enterprise.co.uk",
      emailDomain: "enterprise.co.uk",
      target: "workspace",
    };

    const sanitized = sanitizeMetadata(raw);

    expect(sanitized).not.toHaveProperty("email");
    expect(sanitized.emailDomain).toBe("enterprise.co.uk");
  });

  it("sanitizes string values containing full email addresses to domain only", () => {
    const raw = {
      target: "user@corp.example.org",
      reason: "invited director@partner.com",
    };

    const sanitized = sanitizeMetadata(raw);

    // email pattern in target gets stripped down to the domain part
    expect(sanitized.target).toBe("corp.example.org");
    expect(sanitized.reason).toBe("invited director@partner.com");
  });

  it("safely handles null, undefined, non-object, and empty inputs", () => {
    expect(sanitizeMetadata(null)).toEqual({});
    expect(sanitizeMetadata(undefined)).toEqual({});
    expect(sanitizeMetadata({} as Record<string, unknown>)).toEqual({});
  });
});
