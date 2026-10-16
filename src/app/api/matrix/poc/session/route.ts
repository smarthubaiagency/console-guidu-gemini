import { NextResponse, type NextRequest } from "next/server";

import { requireUser } from "@/core/auth/identity";
import { matrixPocConfig } from "@/core/channels/matrix-poc/config";
import {
  addAttendantToRoom,
  provisionAttendant,
  signLoginJwt,
} from "@/core/channels/matrix-poc/homeserver";
import { readStore, updateStore } from "@/core/channels/matrix-poc/store";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { prisma } from "@/lib/prisma/client";
import { apiErrorResponse } from "@/shared/errors";

/**
 * PROVA DE CONCEITO (IN1). Entrega ao navegador um JWT curto (60 s) para o
 * login `org.matrix.login.jwt`, depois de revalidar a sessão do console e o
 * acesso ao workspace. Provisiona a conta Matrix do usuário pela API admin
 * (na IN3: job ao entrar no workspace) e o põe nas salas do workspace.
 * O atendente nunca vê senha nem token do núcleo.
 */
export async function POST(request: NextRequest) {
  const config = matrixPocConfig();
  if (!config) return new NextResponse(null, { status: 404 });
  try {
    const identity = await requireUser();
    const body = (await request.json()) as { workspaceSlug?: unknown };
    const slug = typeof body.workspaceSlug === "string" ? body.workspaceSlug : "";
    // Lança se o usuário não é membro ativo do workspace.
    await resolveRequestWorkspaceContext(prisma, identity.userId, slug);

    const displayName =
      identity.profile.fullName || identity.email?.split("@")[0] || "Atendente";
    const mxid = await provisionAttendant(config, identity.userId, displayName);
    updateStore(config, (store) => {
      const list = (store.attendants[slug] ??= []);
      if (!list.includes(mxid)) list.push(mxid);
    });
    const rooms = Object.entries(readStore(config).rooms).filter(
      ([, room]) => room.workspaceSlug === slug,
    );
    for (const [roomId] of rooms) {
      await addAttendantToRoom(config, roomId, mxid);
    }
    const localpart = mxid.slice(1).split(":")[0]!;
    return NextResponse.json(
      {
        homeserverUrl: config.homeserverUrl,
        userId: mxid,
        jwt: signLoginJwt(config, localpart, displayName),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
