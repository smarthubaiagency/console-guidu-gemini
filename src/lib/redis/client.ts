import Redis from "ioredis";

/**
 * Shared Redis connection (F4a, plano F4 decisão 1): rate limits now,
 * automations later. Configured by REDIS_URL; without it there is no Redis
 * and callers use their fallback. The connection fails fast: commands are
 * not queued while it is down, so a request never waits on a dead Redis.
 */
let client: Redis | null | undefined;

export function getRedis(): Redis | null {
  if (client !== undefined) return client;
  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    client = null;
    return client;
  }
  client = new Redis(url, {
    lazyConnect: false,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    commandTimeout: 500,
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });
  // Errors surface on the commands; the connection keeps retrying.
  client.on("error", () => undefined);
  return client;
}

/** For tests: drop the cached connection. */
export async function resetRedisForTests(): Promise<void> {
  if (client) await client.quit().catch(() => undefined);
  client = undefined;
}

export type RedisHealth = "ok" | "fail" | "not_configured";

export async function checkRedis(): Promise<RedisHealth> {
  const redis = getRedis();
  if (!redis) return "not_configured";
  try {
    return (await redis.ping()) === "PONG" ? "ok" : "fail";
  } catch {
    return "fail";
  }
}
