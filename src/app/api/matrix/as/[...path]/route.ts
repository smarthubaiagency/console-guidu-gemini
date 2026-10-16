import { timingSafeEqual } from "node:crypto";

import { after, NextResponse, type NextRequest } from "next/server";

import { matrixPocConfig } from "@/core/channels/matrix-poc/config";
import {
  processTransaction,
  unseenEvents,
} from "@/core/channels/matrix-poc/transactions";

/**
 * PROVA DE CONCEITO (IN1, docs/modules/inbox/prova-de-conceito.md).
 * Ponto de entrada do Application Service: o registro do AS aponta para
 * `<app>/api/matrix/as`, e o Synapse chama
 * `/api/matrix/as/_matrix/app/v1/...`. Um catch-all evita a pasta
 * `_matrix`, que o App Router trataria como pasta privada.
 * Só existe com GUIDU_INBOX_POC=1; sem a flag, 404.
 */

function authorized(request: NextRequest, hsToken: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const given = Buffer.from(header.replace(/^Bearer /, ""));
  const expected = Buffer.from(hsToken);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function matrixError(status: number, errcode: string, error: string) {
  return NextResponse.json({ errcode, error }, { status });
}

type Context = { params: Promise<{ path: string[] }> };

async function handle(request: NextRequest, { params }: Context) {
  const config = matrixPocConfig();
  if (!config) return new NextResponse(null, { status: 404 });
  const { path } = await params;
  const route = path.join("/");
  if (!route.startsWith("_matrix/app/v1/")) {
    return matrixError(404, "M_UNRECOGNIZED", "Unknown endpoint");
  }
  if (!authorized(request, config.hsToken)) {
    return matrixError(403, "M_FORBIDDEN", "Bad hs_token");
  }
  const rest = route.slice("_matrix/app/v1/".length);

  if (request.method === "PUT" && rest.startsWith("transactions/")) {
    const txnId = rest.slice("transactions/".length);
    const body = (await request.json()) as { events?: unknown[] };
    const events = unseenEvents(
      config,
      (body.events ?? []) as Parameters<typeof processTransaction>[2],
    );
    if (events.length > 0) {
      // Responde já; o trabalho roda depois (na IN3: job no worker).
      after(() => processTransaction(config, txnId, events));
    }
    return NextResponse.json({});
  }
  if (request.method === "POST" && rest === "ping") {
    return NextResponse.json({});
  }
  // Consultas de usuário e de alias: o núcleo cria os usuários antes.
  return matrixError(404, "M_NOT_FOUND", "Not found");
}

export const PUT = handle;
export const POST = handle;
export const GET = handle;
