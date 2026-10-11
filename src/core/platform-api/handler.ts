import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getPlatformAdminMember } from "@/core/admin/platform";
import type { ApiDeps } from "@/core/api/handler";
import {
  hitRateLimit,
  type RateDecision,
  RateLimitedError,
  rateLimitHeaders,
} from "@/core/api/rate-limit";
import { InvalidApiKeyError } from "@/core/mcp/authenticate";
import { PermissionDeniedError } from "@/core/permissions/guard";
import type { PlatformAdminRoleKey } from "@/core/permissions/matrix";
import { requestHost } from "@/core/partners/hosts";
import { resolvePartnerForHost } from "@/core/partners/resolve";
import { AppError, apiErrorResponse } from "@/shared/errors";

import type { PlatformActor } from "./context";
import { authenticatePlatformApiKey } from "./keys";
import {
  CustomerListQuery,
  FailedJob,
  FailedJobsQuery,
  PlatformCustomer,
  PlatformHealth,
} from "./resources";
import { type PlatformScope, roleAllowsScope } from "./scopes";

/**
 * Entry of the platform API (F4e) at `/api/v1/platform`, in this order:
 *
 * 1. Platform host only (ADR 0012); partner hosts answer 404.
 * 2. Principal: an administrative key (`Bearer gdu_admin_…`) or the browser
 *    session of an internal role member with MFA verified. A workspace key
 *    is refused here, and an administrative key on a workspace route (AC09).
 * 3. Scope of the key and permission of the current internal role.
 * 4. Rate limit per key and per person, then query validation (422), the
 *    service and the output schema of the route (AC07).
 */

export type PlatformRoute = Readonly<{
  operationId: string;
  path: string;
  summary: string;
  scope: PlatformScope;
  query?: z.ZodObject;
  response: z.ZodType;
}>;

const one = <T extends z.ZodType>(data: T) => z.object({ data });

export const PLATFORM_API_ROUTES = {
  listCustomers: {
    operationId: "listPlatformCustomers",
    path: "/platform/customers",
    summary:
      "Empresas clientes, das mais recentes, com dados comerciais mínimos.",
    scope: "admin:customers:read",
    query: CustomerListQuery,
    response: z.object({
      data: z.array(PlatformCustomer),
      nextCursor: z.string().nullable(),
    }),
  },
  getCustomer: {
    operationId: "getPlatformCustomer",
    path: "/platform/customers/{id}",
    summary: "Resumo de uma empresa cliente.",
    scope: "admin:customers:read",
    response: one(PlatformCustomer),
  },
  getHealth: {
    operationId: "getPlatformHealth",
    path: "/platform/health",
    summary: "Saúde do worker e das filas, sem conteúdo de cliente.",
    scope: "admin:operations:read",
    response: one(PlatformHealth),
  },
  listFailedJobs: {
    operationId: "listPlatformFailedJobs",
    path: "/platform/failed-jobs",
    summary: "Jobs com falha dos últimos dias (padrão 7, até 30).",
    scope: "admin:operations:read",
    query: FailedJobsQuery,
    response: z.object({ data: z.array(FailedJob) }),
  },
} as const satisfies Record<string, PlatformRoute>;

export type PlatformCall = Readonly<{
  requestId: string;
  actor: PlatformActor;
  query: Record<string, unknown>;
}>;

function notFound(requestId: string): AppError {
  return new AppError({
    code: "not_found",
    safeMessage: "Recurso não encontrado.",
    requestId,
  });
}

/** Platform host and principal of a platform API or MCP request. */
export async function authenticatePlatformRequest(
  request: Request,
  deps: ApiDeps,
  requestId: string,
  options: Readonly<{ allowSession: boolean; origin: "api" | "mcp" }>,
): Promise<PlatformActor & { scopes: readonly PlatformScope[] | null }> {
  const partner = await resolvePartnerForHost(
    deps.prisma,
    requestHost((name) => request.headers.get(name)),
  );
  if (!partner?.isPlatformHost) throw notFound(requestId);

  const authorization = request.headers.get("authorization");
  if (authorization === null) {
    if (!options.allowSession) throw new InvalidApiKeyError(requestId);
    const session = await deps.session();
    const member = await getPlatformAdminMember(deps.prisma, session.userId);
    if (!member) throw new PermissionDeniedError();
    if (!session.mfaSatisfied) {
      throw new AppError({
        code: "forbidden",
        safeMessage: "Confirme a verificação em duas etapas para continuar.",
        requestId,
      });
    }
    return {
      userId: session.userId,
      role: member.role as PlatformAdminRoleKey,
      keyId: null,
      scopes: null,
    };
  }
  const match = /^Bearer\s+(\S+)$/.exec(authorization.trim());
  if (!match?.[1]) throw new InvalidApiKeyError(requestId);
  return authenticatePlatformApiKey(deps.prisma, match[1], {
    requestId,
    origin: options.origin,
  });
}

export async function handlePlatformApiRoute(
  request: Request,
  route: PlatformRoute,
  deps: ApiDeps,
  run: (call: PlatformCall) => Promise<unknown>,
): Promise<NextResponse> {
  const requestId = randomUUID();
  let decision: RateDecision | null = null;
  const headers = (): Record<string, string> => ({
    "x-request-id": requestId,
    "cache-control": "no-store",
    ...(decision ? rateLimitHeaders(decision) : {}),
  });

  try {
    const principal = await authenticatePlatformRequest(
      request,
      deps,
      requestId,
      { allowSession: true, origin: "api" },
    );
    if (principal.scopes && !principal.scopes.includes(route.scope)) {
      throw new AppError({
        code: "forbidden",
        safeMessage: `Esta chave não tem o escopo ${route.scope}.`,
        requestId,
      });
    }
    if (!roleAllowsScope(principal.role, route.scope)) {
      throw new PermissionDeniedError();
    }
    decision = await hitRateLimit(
      { redis: deps.redis, prisma: deps.prisma },
      {
        apiKeyId: principal.keyId,
        userId: principal.userId,
        workspaceId: null,
      },
    );
    if (!decision.allowed) throw new RateLimitedError(decision, requestId);

    let query: Record<string, unknown> = {};
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
    const actor: PlatformActor = {
      userId: principal.userId,
      role: principal.role,
      keyId: principal.keyId,
    };
    const data = await run({ requestId, actor, query });
    return NextResponse.json(route.response.parse(data), {
      status: 200,
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
