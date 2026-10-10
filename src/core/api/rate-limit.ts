import type { PrismaClient } from "@prisma/client";
import type Redis from "ioredis";

import { appLog } from "@/lib/telemetry/log";
import { AppError } from "@/shared/errors";

/**
 * Rate limit of the API and MCP (F4a; Especificação §15 e §17.5; plano F4
 * decisão 1). Fixed one-minute windows per API key, user and workspace,
 * counted in Redis; when Redis is missing or failing, counted in Postgres
 * (`private.hit_rate_limit`), so the API is never left without a limit.
 * The limits are provisional and come from configuration.
 */

export type RateLimits = Readonly<{
  key: number;
  user: number;
  workspace: number;
}>;

function positive(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function configuredRateLimits(
  env: Readonly<Record<string, string | undefined>> = process.env,
): RateLimits {
  return {
    key: positive(env.API_RATE_LIMIT_PER_KEY, 60),
    user: positive(env.API_RATE_LIMIT_PER_USER, 120),
    workspace: positive(env.API_RATE_LIMIT_PER_WORKSPACE, 300),
  };
}

export type RateSubject = Readonly<{
  apiKeyId: string | null;
  userId: string;
  workspaceId: string | null;
}>;

export type RateDecision = Readonly<{
  allowed: boolean;
  /** The tightest bucket: its limit and what is left of it. */
  limit: number;
  remaining: number;
  /** Seconds until the current window ends. */
  resetSeconds: number;
  store: "redis" | "postgres";
}>;

type Bucket = Readonly<{ name: string; limit: number }>;

export function bucketsFor(subject: RateSubject, limits: RateLimits): Bucket[] {
  const buckets: Bucket[] = [
    { name: `user:${subject.userId}`, limit: limits.user },
  ];
  if (subject.apiKeyId)
    buckets.unshift({ name: `key:${subject.apiKeyId}`, limit: limits.key });
  if (subject.workspaceId) {
    buckets.push({
      name: `workspace:${subject.workspaceId}`,
      limit: limits.workspace,
    });
  }
  return buckets;
}

async function countInRedis(
  redis: Redis,
  buckets: Bucket[],
  window: number,
): Promise<number[]> {
  const multi = redis.multi();
  for (const bucket of buckets) {
    const key = `rl:${bucket.name}:${window}`;
    multi.incr(key);
    multi.expire(key, 120);
  }
  const results = await multi.exec();
  if (!results) throw new Error("redis transaction aborted");
  return buckets.map((_, i) => {
    const [error, value] = results[i * 2] ?? [new Error("missing"), null];
    if (error) throw error;
    return Number(value);
  });
}

async function countInPostgres(
  prisma: Pick<PrismaClient, "$queryRaw">,
  buckets: Bucket[],
) {
  const counts: number[] = [];
  for (const bucket of buckets) {
    const rows = await prisma.$queryRaw<{ hits: number }[]>`
      select private.hit_rate_limit(${bucket.name}) as hits
    `;
    counts.push(Number(rows[0]?.hits ?? 0));
  }
  return counts;
}

export async function hitRateLimit(
  deps: Readonly<{
    redis: Redis | null;
    prisma: Pick<PrismaClient, "$queryRaw">;
    limits?: RateLimits;
    now?: Date;
  }>,
  subject: RateSubject,
): Promise<RateDecision> {
  const limits = deps.limits ?? configuredRateLimits();
  const now = deps.now ?? new Date();
  const window = Math.floor(now.getTime() / 60_000);
  const resetSeconds = 60 - now.getUTCSeconds();
  const buckets = bucketsFor(subject, limits);

  let counts: number[] | null = null;
  let store: RateDecision["store"] = "redis";
  if (deps.redis) {
    try {
      counts = await countInRedis(deps.redis, buckets, window);
    } catch (error) {
      appLog.warn("rate_limit.redis_unavailable", { error });
    }
  }
  if (!counts) {
    store = "postgres";
    counts = await countInPostgres(deps.prisma, buckets);
  }

  let tightest = {
    limit: buckets[0]!.limit,
    remaining: buckets[0]!.limit - counts[0]!,
  };
  let allowed = true;
  buckets.forEach((bucket, i) => {
    const remaining = bucket.limit - counts![i]!;
    if (remaining < 0) allowed = false;
    if (remaining < tightest.remaining)
      tightest = { limit: bucket.limit, remaining };
  });
  return {
    allowed,
    limit: tightest.limit,
    remaining: Math.max(0, tightest.remaining),
    resetSeconds,
    store,
  };
}

export class RateLimitedError extends AppError {
  constructor(
    readonly decision: RateDecision,
    requestId?: string,
  ) {
    super({
      code: "rate_limited",
      safeMessage:
        "Limite de requisições atingido. Tente de novo em instantes.",
      ...(requestId ? { requestId } : {}),
    });
    this.name = "RateLimitedError";
  }
}

export function rateLimitHeaders(
  decision: RateDecision,
): Record<string, string> {
  return {
    "ratelimit-limit": String(decision.limit),
    "ratelimit-remaining": String(decision.remaining),
    "ratelimit-reset": String(decision.resetSeconds),
    ...(decision.allowed
      ? {}
      : { "retry-after": String(decision.resetSeconds) }),
  };
}
