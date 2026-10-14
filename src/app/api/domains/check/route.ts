import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { domainsConfig } from "@/core/domains/config";
import { isServedHost } from "@/core/domains/runtime";
import { normalizeHost } from "@/core/partners/hosts";
import { prisma } from "@/lib/prisma/client";

export const dynamic = "force-dynamic";

function sameSecret(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Traefik ForwardAuth for custom domains (CF2b, as the legacy
 * `/api/domains/check`). Traefik sends the original host in
 * `X-Forwarded-Host` and the shared secret in `X-Check-Secret`; 200 lets the
 * request through, anything else denies. Fail-closed: no secret configured,
 * a wrong secret, a missing host or a database error all answer 403.
 * Bodyless: Traefik only reads the status.
 */
export async function GET(request: Request) {
  const secret = domainsConfig().checkSecret;
  if (!secret || !sameSecret(request.headers.get("x-check-secret"), secret)) {
    return new NextResponse(null, { status: 403 });
  }
  const host = normalizeHost(
    request.headers.get("x-forwarded-host")?.split(",")[0],
  );
  if (!host) return new NextResponse(null, { status: 403 });
  const served = await isServedHost(prisma, host);
  return new NextResponse(null, {
    status: served ? 200 : 403,
    headers: { "Cache-Control": "no-store" },
  });
}
