import { evidenceResponse } from "@/core/billing/evidence-route";

/** Evidence of a manual payment (P5m); see evidenceResponse. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const { paymentId } = await params;
  return evidenceResponse(paymentId, "partner");
}
