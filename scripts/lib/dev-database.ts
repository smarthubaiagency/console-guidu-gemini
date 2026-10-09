/**
 * Shared database governance validation for migration and seed scripts.
 * Enforces ADR 0008 and ADR 0010:
 * - Only the dedicated `console-guidu` Supabase dev project (ssulunrysnvwyqjlkpry)
 *   or localhost/127.0.0.1 may be targeted by scripts in this repository.
 * - The original `guidu` project (mmwmhlafzewdyqsgfkzk) is explicitly prohibited.
 * - Never logs or exposes raw database URLs or credentials.
 */

export const ALLOWED_DEV_REF = "ssulunrysnvwyqjlkpry";

export interface ValidatedDevDatabase {
  url: string;
  host: string;
  user?: string | undefined;
}

/**
 * Validates that the provided database URL targets an authorized development database.
 * Throws a descriptive Error if the URL is missing, invalid, or targets a forbidden host.
 *
 * @param url Database connection string (typically process.env.MIGRATION_DATABASE_URL)
 * @returns Validated database info with host and sanitized user
 */
export function assertDevDatabase(url?: string): ValidatedDevDatabase {
  if (!url || typeof url !== "string" || url.trim() === "") {
    throw new Error(
      "MIGRATION_DATABASE_URL está ausente. Defina a variável de ambiente antes de executar este script.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Formato de URL de banco de dados inválido.");
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(
      `Protocolo de conexão inválido '${parsed.protocol}'. Esperado 'postgresql:' ou 'postgres:'.`,
    );
  }

  const hostname = parsed.hostname;
  const username = decodeURIComponent(parsed.username);

  const isLocal = hostname === "localhost" || hostname === "127.0.0.1";
  const isAllowedDevProject =
    hostname.includes(ALLOWED_DEV_REF) || username.includes(ALLOWED_DEV_REF);

  if (!isLocal && !isAllowedDevProject) {
    throw new Error(
      `Conexão recusada para host '${hostname}'. Somente o projeto Supabase console-guidu (${ALLOWED_DEV_REF}) ou localhost/127.0.0.1 são permitidos para scripts neste repositório (ADR 0010). O projeto guidu (mmwmhlafzewdyqsgfkzk) e quaisquer outros são proibidos.`,
    );
  }

  return {
    url,
    host: hostname,
    user: username ? username.split(".")[0] : undefined,
  };
}
