import { NextResponse } from "next/server";

import { requireUser } from "@/core/auth/identity";
import { resolveRequestWorkspaceContext } from "@/core/partners/request-context";
import { loadExportFile } from "@/core/privacy/export";
import { verifyExportLink } from "@/core/privacy/links";
import { prisma } from "@/lib/prisma/client";
import { withContext } from "@/lib/prisma/with-context";
import { apiErrorResponse } from "@/shared/errors";

/**
 * Download of a workspace export (F3e). The link is short (15 minutes) and
 * bound to the export and the person; the session, the permission, MFA and
 * the export's own expiry are checked again on every request.
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceSlug: string; exportId: string }> },
) {
  try {
    const { workspaceSlug, exportId } = await params;
    const identity = await requireUser();
    const url = new URL(request.url);
    const expires = Number(url.searchParams.get("expires"));
    const signature = url.searchParams.get("signature") ?? "";
    if (!verifyExportLink(exportId, identity.userId, expires, signature)) {
      return NextResponse.json(
        { error: "Link expirado. Gere um novo na página Dados e privacidade." },
        { status: 410, headers: { "cache-control": "no-store" } },
      );
    }
    const context = await resolveRequestWorkspaceContext(
      prisma,
      identity.userId,
      workspaceSlug,
    );
    const file = await withContext(prisma, context, (tx) =>
      loadExportFile(tx, context, exportId, {
        mfaVerified: identity.mfaSatisfied,
      }),
    );
    return new NextResponse(new Uint8Array(file.file), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${file.fileName}"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-content-sha256": file.sha256,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
