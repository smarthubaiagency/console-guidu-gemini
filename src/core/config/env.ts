import { z } from "zod";

/**
 * Environment check at startup (F6a).
 *
 * The web server (`src/instrumentation.ts`) and the worker
 * (`src/worker/index.ts`) validate their variables before taking any
 * request or job. Production refuses to start when a required variable is
 * missing or malformed; development and tests keep their defaults. Messages
 * name the variable and the rule, never the value.
 */

type Env = Readonly<Record<string, string | undefined>>;

const required = z
  .string({ error: "obrigatória" })
  .trim()
  .min(1, { error: "obrigatória" });

const postgresUrl = required.refine(
  (value) => /^postgres(ql)?:\/\//.test(value),
  { error: "deve ser uma URL postgres://" },
);

const httpsOrigin = required.refine(
  (value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.pathname === "/" && !url.search;
    } catch {
      return false;
    }
  },
  { error: "deve ser uma origem https:// sem caminho" },
);

const httpsUrl = required.refine((value) => value.startsWith("https://"), {
  error: "deve começar com https://",
});

/** 32 bytes in 64 hex or 44 base64 characters, as crypto.ts accepts. */
const encryptionKey = required.refine(
  (value) =>
    /^[0-9a-fA-F]{64}$/.test(value) || /^[A-Za-z0-9+/]{43}=$/.test(value),
  { error: "deve ter 32 bytes (64 hex ou 44 base64)" },
);

const notFakeTranslation = z
  .string()
  .optional()
  .refine((value) => value?.trim() !== "fake", {
    error: "o tradutor de teste não roda em produção",
  });

const WEB = z.object({
  DATABASE_URL: postgresUrl,
  APP_URL: httpsOrigin,
  APP_NAME: required,
  ENCRYPTION_KEY: encryptionKey,
  PARTNER_SUBDOMAIN_BASE: required,
  TRANSLATION_PROVIDER: notFakeTranslation,
});

/** Supabase accepts either the public or the server-only names. */
function supabaseProblems(env: Env): string[] {
  const problems: string[] = [];
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  if (!httpsUrl.safeParse(url).success) {
    problems.push(
      "NEXT_PUBLIC_SUPABASE_URL: obrigatória e https:// (ou SUPABASE_URL)",
    );
  }
  const key =
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    env.SUPABASE_ANON_KEY;
  if (!key?.trim()) {
    problems.push(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: obrigatória (ou NEXT_PUBLIC_SUPABASE_ANON_KEY)",
    );
  }
  return problems;
}

const WORKER = z.object({
  WORKER_DATABASE_URL: postgresUrl,
  APP_URL: httpsOrigin,
  APP_NAME: required,
  TRANSLATION_PROVIDER: notFakeTranslation,
});

export type EnvTarget = "web" | "worker";

/** Problems of the environment, one line per variable; values never shown. */
export function envProblems(target: EnvTarget, env: Env): string[] {
  const result = (target === "web" ? WEB : WORKER).safeParse(env);
  const problems = result.success
    ? []
    : result.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      );
  return target === "web" ? [...problems, ...supabaseProblems(env)] : problems;
}

/**
 * Throws in production when the environment is incomplete, listing every
 * problem at once so a deploy is fixed in one go.
 */
export function assertEnv(target: EnvTarget, env: Env = process.env): void {
  if (env.NODE_ENV !== "production") return;
  const problems = envProblems(target, env);
  if (problems.length > 0) {
    throw new Error(
      `Configuração inválida (${target}):\n- ${problems.join("\n- ")}`,
    );
  }
}
