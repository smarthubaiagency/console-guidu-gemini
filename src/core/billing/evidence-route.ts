import "server-only";

import { NextResponse } from "next/server";

import { partnerActor, platformActor } from "@/core/partners/actors";
import { prisma } from "@/lib/prisma/client";
import { withIdentityContext } from "@/lib/prisma/with-identity-context";

import { canReadPartnerBilling, canReadPlatformBilling } from "./access";
import { loadPaymentEvidence } from "./partner";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Evidence file of a manual payment (P5m), for the platform and for the
 * partner of the host. Role checks here, RLS on the row; anything else is a
 * 404. Served as an attachment that the browser never sniffs or runs.
 */
export async function evidenceResponse(
  paymentId: string,
  side: "platform" | "partner",
): Promise<NextResponse> {
  const notFound = new NextResponse(null, { status: 404 });
  if (!UUID.test(paymentId)) return notFound;
  try {
    let userId: string;
    let partnerId: string;
    if (side === "platform") {
      const actor = await platformActor();
      if (
        !canReadPlatformBilling({
          userId: actor.userId,
          platformRole: actor.role,
        })
      ) {
        return notFound;
      }
      ({ userId, partnerId } = actor);
    } else {
      const actor = await partnerActor();
      if (!canReadPartnerBilling(actor)) return notFound;
      ({ userId, partnerId } = actor);
    }
    const evidence = await withIdentityContext(
      prisma,
      userId,
      (tx) => loadPaymentEvidence(tx, paymentId),
      { partnerId },
    );
    if (!evidence) return notFound;
    const extension =
      evidence.mime === "application/pdf" ? "pdf" : evidence.mime.split("/")[1];
    return new NextResponse(Buffer.from(evidence.bytes), {
      status: 200,
      headers: {
        "Content-Type": evidence.mime,
        "Content-Length": String(evidence.bytes.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Disposition": `attachment; filename="comprovante-${paymentId.slice(0, 8)}.${extension}"`,
      },
    });
  } catch {
    return notFound;
  }
}
