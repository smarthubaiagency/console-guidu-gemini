/**
 * Public Supabase configuration shared by the browser and the server clients.
 *
 * Only the project URL and the publishable (anon) key belong here: both are
 * meant to be visible to the browser. Service keys, database URLs and any
 * other secret stay out of this module and out of every `NEXT_PUBLIC_*`
 * variable.
 */

export type SupabasePublicConfig = Readonly<{
  url: string;
  publishableKey: string;
}>;

/**
 * Reads a variable that is only defined on the server. The indexed access
 * keeps Next.js from inlining it into client bundles, where `process.env` is
 * an empty object and the lookup simply yields `undefined`.
 */
function serverEnv(name: string): string | undefined {
  if (typeof window !== "undefined") return undefined;
  return process.env[name];
}

/**
 * Resolves the public configuration at request time. Reading it lazily keeps
 * `next build` working in environments without Supabase variables; a request
 * that actually needs Supabase fails loudly instead of silently talking to the
 * wrong project.
 */
export function readSupabasePublicConfig(): SupabasePublicConfig {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || serverEnv("SUPABASE_URL");
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    serverEnv("SUPABASE_ANON_KEY");

  if (!url || !publishableKey) {
    throw new Error(
      "Supabase não está configurado: defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }

  return { url, publishableKey };
}
