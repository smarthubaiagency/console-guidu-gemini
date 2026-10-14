import type { CloudflareConfig } from "./config";

/**
 * Cloudflare for SaaS custom hostnames (CF2b), as in the legacy
 * (cartaopro-linkko `lib/server/cloudflare.ts`): one custom hostname per
 * domain with a DV certificate validated over HTTP. The token never leaves
 * this module and no response body is logged.
 */

export type SslStatus = "pending" | "active" | "error";

export type CustomHostname = Readonly<{ id: string; ssl: SslStatus }>;

export type CloudflareClient = Readonly<{
  /** Creates the hostname, or revalidates it when it exists without a certificate. */
  upsert(host: string): Promise<CustomHostname>;
  /** Current state; revalidates when the certificate is not active. */
  refresh(id: string): Promise<CustomHostname>;
  remove(id: string): Promise<void>;
}>;

export class CloudflareError extends Error {
  constructor(readonly status: number) {
    super(`Cloudflare request failed (${status})`);
    this.name = "CloudflareError";
  }
}

/** Cloudflare certificate states folded into three. */
export function sslStatusOf(raw: string | undefined): SslStatus {
  if (raw === "active") return "active";
  if (
    raw === "expired" ||
    raw === "timed_out" ||
    raw === "validation_timed_out" ||
    raw === "issuance_timed_out" ||
    raw === "deleted"
  ) {
    return "error";
  }
  return "pending";
}

type Envelope<T> = { success?: boolean; result?: T };
type RawHostname = { id?: unknown; ssl?: { status?: string } };

const SSL = { method: "http", type: "dv", settings: { http2: "on" } };
const TIMEOUT_MS = 10_000;

export function cloudflareClient(
  config: CloudflareConfig,
  fetchImpl: typeof fetch = fetch,
): CloudflareClient {
  const base = `${config.apiBase.replace(/\/$/, "")}/zones/${encodeURIComponent(config.zoneId)}/custom_hostnames`;

  async function call<T>(
    url: string,
    init: RequestInit = {},
  ): Promise<Envelope<T>> {
    const response = await fetchImpl(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => ({}))) as Envelope<T>;
    if (!response.ok || body.success !== true) {
      throw new CloudflareError(response.status);
    }
    return body;
  }

  function hostname(raw: RawHostname | undefined): CustomHostname {
    if (!raw || typeof raw.id !== "string" || raw.id.length === 0) {
      throw new CloudflareError(502);
    }
    return { id: raw.id, ssl: sslStatusOf(raw.ssl?.status) };
  }

  async function revalidate(id: string): Promise<CustomHostname> {
    const body = await call<RawHostname>(`${base}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ ssl: SSL }),
    });
    return hostname(body.result);
  }

  return {
    async upsert(host) {
      const found = await call<RawHostname[]>(
        `${base}?hostname=${encodeURIComponent(host)}`,
      );
      const existing = found.result?.[0];
      if (existing) {
        const current = hostname(existing);
        return current.ssl === "active" ? current : revalidate(current.id);
      }
      const created = await call<RawHostname>(base, {
        method: "POST",
        body: JSON.stringify({ hostname: host, ssl: SSL }),
      });
      return hostname(created.result);
    },
    async refresh(id) {
      const body = await call<RawHostname>(`${base}/${encodeURIComponent(id)}`);
      const current = hostname(body.result);
      return current.ssl === "active" ? current : revalidate(current.id);
    },
    async remove(id) {
      await call(`${base}/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
  };
}
