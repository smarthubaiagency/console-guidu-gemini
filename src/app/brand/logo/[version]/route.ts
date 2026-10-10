import { NextResponse } from "next/server";

import { loadBrandLogo } from "@/core/brand/resolve";
import { getRequestPartner } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";

/**
 * Logo of one brand version of the request host's partner (ADR 0012, P3).
 * Versions are immutable, so the response is cacheable for a long time.
 * Only bytes whose signature was checked on upload are stored; nosniff and a
 * restrictive CSP keep the browser from treating them as anything else.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ version: string }> },
) {
  const { version: raw } = await params;
  const version = /^[1-9]\d{0,8}$/.test(raw) ? Number(raw) : null;
  const partner = await getRequestPartner();
  if (!version || !partner) {
    return new NextResponse(null, { status: 404 });
  }

  const logo = await loadBrandLogo(prisma, partner.partnerId, version);
  if (!logo) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(Buffer.from(logo.bytes), {
    status: 200,
    headers: {
      "Content-Type": logo.mime,
      "Content-Length": String(logo.bytes.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": "inline",
    },
  });
}
