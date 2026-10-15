import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Guard coverage (F6a): every page, Route Handler and Server Action checks
 * the identity on the server itself. Layouts and src/proxy.ts are navigation
 * aids, never the guard. A new file must call one of the guards of its area
 * or be listed below as public, with the reason.
 */
const SRC = join(process.cwd(), "src");
const APP = join(SRC, "app");

const GUARDS = {
  user: ["requireUserPage", "requireUser", "requireMfa"],
  workspace: ["resolveRequestWorkspaceContext"],
  admin: ["requirePartnerConsolePage", "partnerActor", "evidenceResponse"],
  platform: ["requirePlatformAdminPage", "platformActor", "evidenceResponse"],
  api: ["handleApiRoute", "requireUser"],
  platformApi: ["handlePlatformApiRoute", "requireMfa"],
  mcp: ["handleMcpWorkspaceRequest", "handlePlatformMcpRequest"],
} as const;

/** Every guard an action may call, directly or through a local helper. */
const ACTION_GUARDS = new Set<string>([
  ...Object.values(GUARDS).flat(),
  "readSessionClaims",
]);

/** Pages and routes anyone may open, and why. */
const PUBLIC: Record<string, string> = {
  "page.tsx": "entrada: só redireciona conforme a sessão",
  "login/page.tsx": "login",
  "forgot-password/page.tsx": "recuperação de senha",
  "reset-password/page.tsx": "troca de senha; a ação confere a sessão",
  "legal/[kind]/page.tsx": "termos públicos",
  "auth/denied/page.tsx": "aviso de acesso negado",
  "maintenance/page.tsx":
    "aviso da manutenção (CF5c); só diz que a plataforma está fechada",
  "auth/suspended/page.tsx": "aviso de conta suspensa",
  "auth/mfa/page.tsx": "desafio de MFA; confere a sessão",
  "invite/[token]/page.tsx": "convite; a ação de aceite exige login",
  "partner-invite/[token]/page.tsx": "convite; a ação de aceite exige login",
  "auth/callback/route.ts": "retorno do Supabase Auth",
  "auth/signout/route.ts": "logout; confere a origem",
  "api/health/live/route.ts": "saúde do processo",
  "api/health/ready/route.ts": "saúde das dependências",
  "api/v1/openapi.json/route.ts": "contrato público da API",
  "api/channels/[connectionId]/[token]/route.ts":
    "webhook de um canal; confere o hash do token da conexão (A5a)",
  "brand/[asset]/[version]/route.ts": "imagens da marca do host",
  "api/domains/check/route.ts":
    "ForwardAuth do Traefik; confere o segredo compartilhado (CF2b)",
  "api/billing/stripe/webhook/route.ts":
    "webhook do Stripe; confere a assinatura com o segredo cifrado (CF7)",
};

/** Actions of signed-out visitors. */
const PUBLIC_ACTIONS: Record<string, string> = {
  "app/login/actions.ts: signInWithPassword": "login",
  "app/login/actions.ts: signInWithGoogle":
    "login com Google; confere o provedor e a cascata do host (CF5b)",
  "app/login/actions.ts: requestMagicLink":
    "link mágico; confere o provedor e a cascata do host, resposta igual para qualquer e-mail (CF5b)",
  "app/forgot-password/actions.ts: requestPasswordRecovery":
    "pedido de recuperação; resposta igual para qualquer e-mail",
};

/** Old addresses that only redirect to a guarded page. */
const REDIRECT_ONLY = new Set([
  "app/[workspaceSlug]/crm/contacts/[contactId]/page.tsx",
  "app/[workspaceSlug]/hello-world/records/[recordId]/page.tsx",
  "app/[workspaceSlug]/portfolio/[itemId]/page.tsx",
  // Settings indexes (CF1): open the guarded General page of their level.
  "admin/settings/page.tsx",
  "app/[workspaceSlug]/settings/page.tsx",
  "platform/settings/page.tsx",
  // Marca moved to Configurações (CF2).
  "admin/brand/page.tsx",
  "platform/brand/page.tsx",
]);

function files(dir: string, match: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, match);
    return match(name) ? [path] : [];
  });
}

function posix(path: string): string {
  return path.split(sep).join("/");
}

function calls(source: string, names: readonly string[]): boolean {
  return names.some((name) => new RegExp(`\\b${name}\\s*\\(`).test(source));
}

/** Guards each entry point must reach, by area. Null means: not covered. */
function requiredGuards(path: string): (readonly string[])[] | null {
  if (path.startsWith("admin/")) return [GUARDS.admin];
  if (path.startsWith("platform/")) return [GUARDS.platform];
  if (path.startsWith("app/[workspaceSlug]/"))
    return [GUARDS.user, GUARDS.workspace];
  if (path.startsWith("app/") || path === "legal/accept/page.tsx")
    return [GUARDS.user];
  if (path.startsWith("api/v1/platform/")) return [GUARDS.platformApi];
  if (path.startsWith("api/v1/")) return [GUARDS.api];
  if (path.startsWith("mcp/")) return [GUARDS.mcp];
  return null;
}

describe("guard coverage (F6a)", () => {
  const entries = files(
    APP,
    (name) => name === "page.tsx" || name === "route.ts",
  ).map((path) => posix(relative(APP, path)));

  it("finds the pages and routes", () => {
    expect(entries.length).toBeGreaterThan(90);
  });

  it("calls the guard of its area in every page and route", () => {
    const problems = entries
      .filter((path) => !(path in PUBLIC) && !REDIRECT_ONLY.has(path))
      .flatMap((path) => {
        const required = requiredGuards(path);
        if (!required) return [`${path}: área sem guard definido`];
        const source = readFileSync(join(APP, path), "utf8");
        return required
          .filter((guards) => !calls(source, guards))
          .map((guards) => `${path}: falta ${guards.join(" | ")}`);
      });
    expect(problems).toEqual([]);
  });

  it("keeps redirect-only pages free of data access", () => {
    for (const path of REDIRECT_ONLY) {
      const source = readFileSync(join(APP, path), "utf8");
      expect(source, path).toMatch(/\bredirect\(/);
      expect(source, path).not.toMatch(/prisma|withContext|@\/core|@\/modules/);
    }
  });

  it("checks the identity in every exported Server Action", () => {
    const actionFiles = files(SRC, (name) => /\.tsx?$/.test(name)).filter(
      (path) =>
        !/\.test\.tsx?$/.test(path) &&
        /^\s*["']use server["']/.test(readFileSync(path, "utf8")),
    );
    expect(actionFiles.length).toBeGreaterThan(20);

    const problems = actionFiles.flatMap((path) => {
      const source = ts.createSourceFile(
        path,
        readFileSync(path, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      // Top-level functions of the file and the names each one calls.
      const bodies = new Map<string, ts.Node>();
      const exported: string[] = [];
      for (const statement of source.statements) {
        const isExported = ts
          .getModifiers(statement as ts.HasModifiers)
          ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        if (ts.isFunctionDeclaration(statement) && statement.name) {
          bodies.set(statement.name.text, statement);
          if (isExported) exported.push(statement.name.text);
        }
        if (ts.isVariableStatement(statement)) {
          for (const decl of statement.declarationList.declarations) {
            if (
              ts.isIdentifier(decl.name) &&
              decl.initializer &&
              (ts.isArrowFunction(decl.initializer) ||
                ts.isFunctionExpression(decl.initializer))
            ) {
              bodies.set(decl.name.text, decl.initializer);
              if (isExported) exported.push(decl.name.text);
            }
          }
        }
      }
      const called = new Map<string, Set<string>>();
      for (const [name, node] of bodies) {
        const names = new Set<string>();
        const visit = (child: ts.Node) => {
          if (ts.isCallExpression(child)) {
            const callee = child.expression;
            if (ts.isIdentifier(callee)) names.add(callee.text);
          }
          ts.forEachChild(child, visit);
        };
        visit(node);
        called.set(name, names);
      }
      // A local helper counts once it reaches a guard itself.
      const guarded = new Set<string>();
      for (let changed = true; changed;) {
        changed = false;
        for (const [name, names] of called) {
          if (guarded.has(name)) continue;
          if ([...names].some((n) => ACTION_GUARDS.has(n) || guarded.has(n))) {
            guarded.add(name);
            changed = true;
          }
        }
      }
      return exported
        .filter((name) => !guarded.has(name))
        .map((name) => `${posix(relative(SRC, path))}: ${name}`)
        .filter((entry) => !(entry in PUBLIC_ACTIONS));
    });
    expect(problems).toEqual([]);
  });
});
