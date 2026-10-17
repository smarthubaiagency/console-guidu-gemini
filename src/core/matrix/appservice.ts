import { createHash, timingSafeEqual } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { matrixConfig, type MatrixConfig } from "./config";
import { reduceEvent } from "./events";

/**
 * Entry of the Application Service (IN3, ADR 0023 rule 8). The registration
 * points at `<app>/api/matrix/as`, and Synapse calls
 * `/api/matrix/as/_matrix/app/v1/...` (a catch-all, because the App Router
 * treats a `_matrix` folder as private). The hs_token is compared in
 * constant time; a transaction is recorded and answered at once, and a job
 * of the worker processes it (ADR 0011, rules 1 and 5). Synapse retries a
 * transaction until it gets a 200, and the event id keeps a retry from
 * doubling anything.
 */

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const PREFIX = "_matrix/app/v1/";
const NO_STORE = { "cache-control": "no-store" };

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function matrixError(status: number, errcode: string, error: string): Response {
  return json(status, { errcode, error });
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function hsTokenMatches(
  request: Request,
  config: MatrixConfig,
): boolean {
  const header = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
  const given =
    bearer ?? new URL(request.url).searchParams.get("access_token") ?? "";
  // Digests have the same length, so the comparison never leaks it.
  return (
    given.length > 0 && timingSafeEqual(digest(given), digest(config.hsToken))
  );
}

export type AppServiceDeps = Readonly<{
  prisma: PrismaClient;
  config?: MatrixConfig | null;
}>;

export async function handleAppServiceRequest(
  request: Request,
  path: readonly string[],
  deps: AppServiceDeps,
): Promise<Response> {
  const config = deps.config === undefined ? matrixConfig() : deps.config;
  if (!config) return new Response(null, { status: 404, headers: NO_STORE });
  const route = path.join("/");
  if (!route.startsWith(PREFIX)) {
    return matrixError(404, "M_UNRECOGNIZED", "Unrecognized request");
  }
  if (!hsTokenMatches(request, config)) {
    return matrixError(403, "M_FORBIDDEN", "Bad token");
  }
  const rest = route.slice(PREFIX.length);
  const method = request.method.toUpperCase();

  if (method === "PUT" && /^transactions\/[^/]+$/.test(rest)) {
    const txnId = rest.slice("transactions/".length);
    if (txnId.length < 1 || txnId.length > 255) {
      return matrixError(400, "M_INVALID_PARAM", "Bad transaction id");
    }
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_BODY_BYTES)
      return matrixError(413, "M_TOO_LARGE", "Too large");
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES)
      return matrixError(413, "M_TOO_LARGE", "Too large");
    let body: { events?: unknown };
    try {
      body = JSON.parse(raw) as { events?: unknown };
    } catch {
      return matrixError(400, "M_NOT_JSON", "Body is not JSON");
    }
    const events = Array.isArray(body.events) ? body.events : [];
    const reduced = events.map(reduceEvent).filter((e) => e !== null);
    try {
      await deps.prisma.$queryRaw`
        select private.matrix_as_ingest(${txnId}, ${events.length}::integer, ${JSON.stringify(reduced)}::jsonb)
      `;
    } catch (error) {
      console.error("[matrix] transaction not recorded", {
        txnId,
        error: String(error).slice(0, 200),
      });
      // Synapse tries the same transaction again later.
      return matrixError(500, "M_UNKNOWN", "Not recorded");
    }
    return json(200, {});
  }

  if (method === "POST" && rest === "ping") {
    return json(200, {});
  }

  // Users and aliases of the namespace are created by the core itself.
  if (method === "GET" && /^(users|rooms)\/[^/]+$/.test(rest)) {
    return matrixError(404, "M_NOT_FOUND", "Not found");
  }

  return matrixError(404, "M_UNRECOGNIZED", "Unrecognized request");
}
