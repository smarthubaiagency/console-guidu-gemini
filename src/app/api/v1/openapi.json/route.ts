import { NextResponse } from "next/server";

import { buildOpenApiDocument } from "@/core/api/openapi";

/** Public OpenAPI document of the API v1 (F4a); no data, only the contract. */
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return NextResponse.json(buildOpenApiDocument(new URL(request.url).origin), {
    headers: { "cache-control": "public, max-age=300" },
  });
}
