import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import type Redis from "ioredis";
import { NextResponse } from "next/server";

import { resolveWorkspaceContext } from "@/core/auth/context";
import {
  authenticateApiKey,
  InvalidApiKeyError,
} from "@/core/mcp/authenticate";
import type { WorkspaceScopeType } from "@/core/mcp/scopes";
import { requestHost } from "@/core/partners/hosts";
import { resolvePartnerForHost } from "@/core/partners/resolve";
import { listUserWorkspaces } from "@/core/workspaces/navigation";
import type { RequestContext } from "@/lib/prisma/with-context";
import { AppError, apiErrorResponse } from "@/shared/errors";

import type { ApiRoute } from "./contracts";
import {
  hitRateLimit,
  type RateDecision,
  RateLimitedError,
  rateLimitHeaders,
} from "./rate-limit";

/**
 * Single entry of the REST API (F4a, Especificação §15). Every route goes
 * through the same steps, in this order:
 *
 * 1. Partner of the request host (ADR 0012); unknown hosts get 404.
 * 2. Principal: an API key (`Authorization: Bearer gdu_live_…`, ADR 0009)
 *    or the browser session. A key works only on its partner's hosts and
 *    is re-checked on every request, so revocation and membership changes
 *    apply at once (AC03).
 * 3. Scope of the key for the route (§17.3); sessions use the role only.
 * 4. Workspace of the route: a key reaches only its own workspace; a
 *    session only workspaces where the person is an active member. Others
 *    answer 404, never revealing that they exist (AC01).
 * 5. Rate limit per key, user and workspace (429 with Retry-After).
 * 6. Query validation (422), then the service, whose output is parsed by
 *    the route's schema: fields outside the contract never leave (AC07).
 */

export type ApiPrincipal =
  | Readonly<{ kind: "session"; userId: string; mfaSatisfied: boolean }>
  | Readonly<{
      kind: "api_key";
      userId: string;
      apiKeyId: string;
      workspaceId: string;
      organizationId: string;
      scopes: readonly WorkspaceScopeType[];
    }>;

export type ApiCall = Readonly<{
  requestId: string;
  partnerId: string;
  principal: ApiPrincipal;
  /** Set for workspace routes. */
  context: RequestContext | null;
  query: Record<string, unknown>;
  /** Parsed JSON body of POST and PATCH. */
  body: unknown;
  /** Path parameters besides the workspace (e.g. contactId). */
  params: Readonly<Record<string, string | undefined>>;
  /** Public origin of the request host, for links (MCP proposals). */
  origin?: string;
}>;

export type ApiDeps = Readonly<{
  prisma: PrismaClient;
  redis: Redis | null;
  /** Browser session; throws AccessDeniedError when there is none. */
  session: () => Promise<{ userId: string; mfaSatisfied: boolean }>;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFound(): AppError {
  return new AppError({
    code: "not_found",
    safeMessage: "Recurso não encontrado.",
  });
}

async function resolvePrincipal(
  request: Request,
  deps: ApiDeps,
  partnerId: string,
  requestId: string,
  origin: "api" | "mcp" = "api",
): Promise<ApiPrincipal> {
  const authorization = request.headers.get("authorization");
  if (authorization === null) {
    const session = await deps.session();
    return {
      kind: "session",
      userId: session.userId,
      mfaSatisfied: session.mfaSatisfied,
    };
  }
  const match = /^Bearer\s+(\S+)$/.exec(authorization.trim());
  if (!match?.[1]) throw new InvalidApiKeyError(requestId);
  const { apiKey } = await authenticateApiKey(deps.prisma, match[1], {
    requestId,
    origin,
  });
  // A key works only on the hosts of its partner (pendência da P2).
  const reachable = await listUserWorkspaces(
    deps.prisma,
    apiKey.userId,
    partnerId,
  );
  if (!reachable.some((w) => w.workspaceId === apiKey.workspaceId)) {
    throw new InvalidApiKeyError(requestId);
  }
  return {
    kind: "api_key",
    userId: apiKey.userId,
    apiKeyId: apiKey.id,
    workspaceId: apiKey.workspaceId,
    organizationId: apiKey.organizationId,
    scopes: apiKey.scopes,
  };
}

async function resolveContext(
  deps: ApiDeps,
  principal: ApiPrincipal,
  partnerId: string,
  workspaceId: string | undefined,
): Promise<RequestContext> {
  if (!workspaceId || !UUID.test(workspaceId)) throw notFound();
  if (principal.kind === "api_key") {
    if (principal.workspaceId !== workspaceId.toLowerCase()) throw notFound();
    return {
      userId: principal.userId,
      workspaceId: principal.workspaceId,
      organizationId: principal.organizationId,
      partnerId,
      principalType: "api_key",
      grantId: principal.apiKeyId,
    };
  }
  const workspaces = await listUserWorkspaces(
    deps.prisma,
    principal.userId,
    partnerId,
  );
  const workspace = workspaces.find(
    (w) => w.workspaceId === workspaceId.toLowerCase(),
  );
  if (!workspace) throw notFound();
  return resolveWorkspaceContext(
    deps.prisma,
    principal.userId,
    workspace.workspaceSlug,
    partnerId,
  );
}

/**
 * Partner of the host and the principal of a request; shared by the REST
 * API and the MCP (which accepts API keys only, ADR 0009).
 */
export async function authenticateRequest(
  request: Request,
  deps: ApiDeps,
  requestId: string,
  options: Readonly<{ allowSession: boolean; origin?: "api" | "mcp" }>,
): Promise<{ partner: { partnerId: string }; principal: ApiPrincipal }> {
  const partner = await resolvePartnerForHost(
    deps.prisma,
    requestHost((name) => request.headers.get(name)),
  );
  if (!partner) throw notFound();
  if (!options.allowSession && request.headers.get("authorization") === null) {
    throw new InvalidApiKeyError(requestId);
  }
  const principal = await resolvePrincipal(
    request,
    deps,
    partner.partnerId,
    requestId,
    options.origin ?? "api",
  );
  return { partner, principal };
}

export async function handleApiRoute(
  request: Request,
  route: ApiRoute,
  params: Readonly<{ id?: string; [name: string]: string | undefined }>,
  deps: ApiDeps,
  run: (call: ApiCall) => Promise<unknown>,
): Promise<NextResponse> {
  const requestId = randomUUID();
  let decision: RateDecision | null = null;
  const headers = (): Record<string, string> => ({
    "x-request-id": requestId,
    "cache-control": "no-store",
    ...(decision ? rateLimitHeaders(decision) : {}),
  });

  try {
    const { partner, principal } = await authenticateRequest(
      request,
      deps,
      requestId,
      { allowSession: true },
    );
    if (
      principal.kind === "api_key" &&
      !principal.scopes.includes(route.scope)
    ) {
      throw new AppError({
        code: "forbidden",
        safeMessage: `Esta chave não tem o escopo ${route.scope}.`,
        requestId,
      });
    }
    const context = route.workspaceScoped
      ? await resolveContext(deps, principal, partner.partnerId, params.id)
      : null;

    decision = await hitRateLimit(
      { redis: deps.redis, prisma: deps.prisma },
      {
        apiKeyId: principal.kind === "api_key" ? principal.apiKeyId : null,
        userId: principal.userId,
        workspaceId: context?.workspaceId ?? null,
      },
    );
    if (!decision.allowed) throw new RateLimitedError(decision, requestId);

    let query: Record<string, unknown> = {};
    // Writes with the browser session: JSON from this very host only, so a
    // cross-site form cannot act with the person's cookies (CSRF).
    if (route.method !== "GET" && principal.kind === "session") {
      const json = (request.headers.get("content-type") ?? "").startsWith(
        "application/json",
      );
      const origin = request.headers.get("origin");
      const host =
        request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ??
        request.headers.get("host");
      let sameOrigin = true;
      if (origin) {
        try {
          sameOrigin = new URL(origin).host === host;
        } catch {
          sameOrigin = false;
        }
      }
      if (!json || !sameOrigin) {
        throw new AppError({
          code: "forbidden",
          safeMessage: "Escrita pela sessão só com JSON do próprio site.",
          requestId,
        });
      }
    }

    let body: unknown = undefined;
    if (route.method !== "GET") {
      try {
        body = await request.json();
      } catch {
        throw new AppError({
          code: "invalid_input",
          safeMessage: "Corpo JSON inválido.",
          requestId,
        });
      }
    }

    if (route.query) {
      const parsed = route.query.safeParse(
        Object.fromEntries(new URL(request.url).searchParams),
      );
      if (!parsed.success) {
        throw new AppError({
          code: "invalid_input",
          safeMessage: "Parâmetros inválidos.",
          requestId,
        });
      }
      query = parsed.data as Record<string, unknown>;
    }

    const data = await run({
      requestId,
      partnerId: partner.partnerId,
      principal,
      context,
      query,
      body,
      params,
    });
    return NextResponse.json(route.response.parse(data), {
      status: route.successStatus ?? 200,
      headers: headers(),
    });
  } catch (error) {
    const response = apiErrorResponse(error, requestId);
    for (const [name, value] of Object.entries(headers())) {
      response.headers.set(name, value);
    }
    return response;
  }
}
