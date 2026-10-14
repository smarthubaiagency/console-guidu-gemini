import { NextResponse } from "next/server";

import { brandAssetKind, loadBrandImage } from "@/core/brand/resolve";
import { getRequestPartner } from "@/core/partners/resolve";
import { prisma } from "@/lib/prisma/client";

/**
 * Image of one brand version of the request host's partner (ADR 0012, P3;
 * CF2): `logo`, `logo-dark`, `favicon` or `share`.
 * Versions are immutable, so the response is cacheable for a long time.
 * Only bytes whose signature was checked on upload are stored; nosniff and a
 * restrictive CSP keep the browser from treating them as anything else.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ asset: string; version: string }> },
) {
  const { asset, version: raw } = await params;
  const kind = brandAssetKind(asset);
  const version = /^[1-9]\d{0,8}$/.test(raw) ? Number(raw) : null;
  if (!kind || !version) {
    return new NextResponse(null, { status: 404 });
  }
  const partner = await getRequestPartner();
  if (!partner) {
    return new NextResponse(null, { status: 404 });
  }

  const image = await loadBrandImage(prisma, partner.partnerId, version, kind);
  if (!image) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(Buffer.from(image.bytes), {
    status: 200,
    headers: {
      "Content-Type": image.mime,
      "Content-Length": String(image.bytes.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": "inline",
    },
  });
}
