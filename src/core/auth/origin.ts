import "server-only";

/**
 * Absolute origin used to build the links Supabase e-mails back to the user.
 *
 * Only the operator-controlled `APP_URL` is accepted. Request `Host` and
 * `X-Forwarded-Host` headers are attacker-controlled unless a deployment has
 * an explicitly trusted proxy chain, so they must never select an auth return
 * destination.
 */
export function parseAppOrigin(configured: string | undefined): string {
  const value = configured?.trim();
  if (!value) throw new Error("APP_URL não configurado.");

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("APP_URL inválido.");
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("APP_URL deve conter apenas uma origem HTTP(S).");
  }

  return url.origin;
}

export function appOrigin(): string {
  return parseAppOrigin(process.env.APP_URL);
}
