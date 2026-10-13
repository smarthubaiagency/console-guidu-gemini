import { describe, expect, it } from "vitest";

import { assertEnv, envProblems } from "./env";

const WEB_OK = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://app_runtime:x@db.example:5432/postgres",
  APP_URL: "https://console.guidu.co",
  APP_NAME: "GUIDU",
  ENCRYPTION_KEY: "a".repeat(64),
  PARTNER_SUBDOMAIN_BASE: "guidu.co",
  NEXT_PUBLIC_SUPABASE_URL: "https://ref.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
};

const WORKER_OK = {
  NODE_ENV: "production",
  WORKER_DATABASE_URL: "postgresql://app_worker:x@db.example:5432/postgres",
  APP_URL: "https://console.guidu.co",
  APP_NAME: "GUIDU",
};

describe("environment check (F6a)", () => {
  it("accepts a complete production environment", () => {
    expect(envProblems("web", WEB_OK)).toEqual([]);
    expect(envProblems("worker", WORKER_OK)).toEqual([]);
  });

  it("lists every problem and never the values", () => {
    const secret = "segredo-que-nao-pode-vazar";
    const problems = envProblems("web", {
      ...WEB_OK,
      APP_URL: `http://${secret}.example`,
      ENCRYPTION_KEY: secret,
      DATABASE_URL: undefined,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
      TRANSLATION_PROVIDER: "fake",
    });
    expect(problems.map((p) => p.split(":")[0]).sort()).toEqual([
      "APP_URL",
      "DATABASE_URL",
      "ENCRYPTION_KEY",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "TRANSLATION_PROVIDER",
    ]);
    expect(problems.join("\n")).not.toContain(secret);
  });

  it("stops production only", () => {
    expect(() => assertEnv("worker", { NODE_ENV: "production" })).toThrow(
      /WORKER_DATABASE_URL: obrigatória/,
    );
    expect(() =>
      assertEnv("worker", { NODE_ENV: "development" }),
    ).not.toThrow();
  });
});
