import type { CloudflareClient } from "./cloudflare";

/**
 * Verification of a custom domain (CF2b): the CNAME must point to the
 * proxy target; then Cloudflare issues the certificate. The domain becomes
 * active when both are ready. Without Cloudflare configured, the proxy
 * issues the certificate and DNS alone activates. Runs outside any
 * transaction (network); the caller writes the result.
 */

export type DomainSslStatus = "none" | "pending" | "active" | "error";

/** Short codes stored in `last_error` and translated on screen. */
export type DomainCheckError =
  | "not_configured"
  | "dns_pending"
  | "ssl_pending"
  | "ssl_error"
  | "cloudflare_error";

export type DomainCheckResult = Readonly<{
  status: "pending" | "active";
  sslStatus: DomainSslStatus;
  cloudflareHostnameId: string | null;
  lastError: DomainCheckError | null;
}>;

export type DomainCheckDeps = Readonly<{
  cnameTarget: string | null;
  cloudflare: CloudflareClient | null;
  resolveCname: (host: string) => Promise<readonly string[]>;
}>;

function sameHost(a: string, b: string): boolean {
  return (
    a.toLowerCase().replace(/\.$/, "") === b.toLowerCase().replace(/\.$/, "")
  );
}

export async function checkDomain(
  host: string,
  current: Readonly<{ cloudflareHostnameId: string | null }>,
  deps: DomainCheckDeps,
): Promise<DomainCheckResult> {
  const pending = (
    lastError: DomainCheckError,
    sslStatus: DomainSslStatus = "none",
    cloudflareHostnameId = current.cloudflareHostnameId,
  ): DomainCheckResult => ({
    status: "pending",
    sslStatus,
    cloudflareHostnameId,
    lastError,
  });

  if (!deps.cnameTarget) return pending("not_configured");

  const cnames = await deps.resolveCname(host).catch(() => []);
  const target = deps.cnameTarget;
  if (!cnames.some((name) => sameHost(name, target))) {
    return pending("dns_pending");
  }

  if (!deps.cloudflare) {
    return {
      status: "active",
      sslStatus: "none",
      cloudflareHostnameId: current.cloudflareHostnameId,
      lastError: null,
    };
  }

  try {
    const hostname = current.cloudflareHostnameId
      ? await deps.cloudflare.refresh(current.cloudflareHostnameId)
      : await deps.cloudflare.upsert(host);
    if (hostname.ssl === "active") {
      return {
        status: "active",
        sslStatus: "active",
        cloudflareHostnameId: hostname.id,
        lastError: null,
      };
    }
    return pending(
      hostname.ssl === "error" ? "ssl_error" : "ssl_pending",
      hostname.ssl,
      hostname.id,
    );
  } catch {
    return pending("cloudflare_error", "error");
  }
}
