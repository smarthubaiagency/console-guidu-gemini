import type { PrismaClient } from "@prisma/client";
import { NextResponse } from "next/server";

import { englishText } from "@/core/i18n/english";

/**
 * Emergency switches of the API (CF6b): the REST API of the workspaces
 * (`api.rest_enabled`) and the workspace MCP (`api.mcp_enabled`), keys of
 * the settings cascade set only by the platform. Off, every call answers
 * 503 in English before any key is read; the keys themselves stay. The
 * platform API and MCP never ask this (the operators' own tools).
 *
 * Every request asks, so the answer is cached per process like the
 * maintenance window: a fresh answer stands `ttlMs` (5 s), the process
 * that saves drops its cache at once, and a failed read keeps the last
 * good answer for 5 minutes, else counts as on (a database that is down
 * fails the requests on its own anyway).
 */

export type ApiSurface = "api" | "mcp";

export type ApiSwitches = Readonly<{ api: boolean; mcp: boolean }>;

export const API_SWITCHES_ON: ApiSwitches = { api: true, mcp: true };

export const API_SWITCH_CACHE_MS = 5_000;
const STALE_MS = 5 * 60_000;

const KEYS = { api: "api.rest_enabled", mcp: "api.mcp_enabled" } as const;

export async function queryApiSwitches(
  client: Pick<PrismaClient, "$queryRaw">,
): Promise<ApiSwitches> {
  const rows = await client.$queryRaw<{ key: string; value: unknown }[]>`
    select key, value from private.settings_cascade()
    where scope = 'platform' and key in ('api.rest_enabled', 'api.mcp_enabled')
  `;
  const value = (key: string) => rows.find((row) => row.key === key)?.value;
  return {
    api: value(KEYS.api) !== false,
    mcp: value(KEYS.mcp) !== false,
  };
}

export type ApiSwitchReader = Readonly<{
  switches(): Promise<ApiSwitches>;
  invalidate(): void;
}>;

export function createApiSwitchReader(
  options: Readonly<{
    load: () => Promise<ApiSwitches>;
    ttlMs?: number;
    onError?: (error: unknown) => void;
  }>,
): ApiSwitchReader {
  const ttl = options.ttlMs ?? API_SWITCH_CACHE_MS;
  let cached: { value: ApiSwitches; at: number } | null = null;
  let lastGood: { value: ApiSwitches; at: number } | null = null;
  let retryAt = 0;
  let inFlight: Promise<ApiSwitches> | null = null;

  const fallback = (): ApiSwitches =>
    lastGood && Date.now() - lastGood.at < STALE_MS
      ? lastGood.value
      : API_SWITCHES_ON;

  return {
    async switches() {
      const now = Date.now();
      if (cached && now - cached.at < ttl) return cached.value;
      if (now < retryAt) return fallback();
      inFlight ??= options
        .load()
        .then((value) => {
          cached = { value, at: Date.now() };
          lastGood = cached;
          return value;
        })
        .catch((error: unknown) => {
          retryAt = Date.now() + ttl;
          options.onError?.(error);
          return fallback();
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
    invalidate() {
      cached = null;
      retryAt = 0;
    },
  };
}

const FALLBACK = {
  api: "The GUIDU API is turned off. Try again later.",
  mcp: "The GUIDU MCP server is turned off. Try again later.",
} as const;

/** 503 of a surface the platform turned off; null while it is on. */
export function apiDisabledResponse(
  switches: ApiSwitches,
  surface: ApiSurface,
  requestId: string,
): NextResponse | null {
  if (switches[surface]) return null;
  const key =
    surface === "api" ? "apiErrors.apiDisabled" : "apiErrors.mcpDisabled";
  return NextResponse.json(
    {
      error: {
        code: "service_disabled",
        message: englishText(key) ?? FALLBACK[surface],
        requestId,
      },
    },
    {
      status: 503,
      headers: { "x-request-id": requestId, "cache-control": "no-store" },
    },
  );
}
