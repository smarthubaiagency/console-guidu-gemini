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

/** Short codes of a default domain check (CF2c), stored in `last_error`. */
export type BaseDomainCheckError =
  "not_configured" | "dns_pending" | "wildcard_pending";

export type BaseDomainCheckResult = Readonly<{
  status: "pending" | "active";
  lastError: BaseDomainCheckError | null;
}>;

/**
 * Verification of a partner's default domain (CF2c): the domain and any
 * name under it (the wildcard) must point to the proxy target. The wildcard
 * is probed with a random label, which only resolves through `*.domain`.
 * The wildcard certificate is an operation step (docs/operacao), so DNS
 * alone activates.
 */
export async function checkBaseDomain(
  host: string,
  deps: Readonly<{
    cnameTarget: string | null;
    resolveCname: (host: string) => Promise<readonly string[]>;
    probeLabel: string;
  }>,
): Promise<BaseDomainCheckResult> {
  if (!deps.cnameTarget)
    return { status: "pending", lastError: "not_configured" };
  const target = deps.cnameTarget;
  const points = async (name: string) =>
    (await deps.resolveCname(name).catch(() => [])).some((value) =>
      sameHost(value, target),
    );
  if (!(await points(host)))
    return { status: "pending", lastError: "dns_pending" };
  if (!(await points(`${deps.probeLabel}.${host}`))) {
    return { status: "pending", lastError: "wildcard_pending" };
  }
  return { status: "active", lastError: null };
}
