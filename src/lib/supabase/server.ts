import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { readSupabasePublicConfig } from "./config";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * A new client is created per request: sharing one across requests would leak
 * another user's session. Identity is never taken from `getSession()` alone —
 * see `src/core/auth/identity.ts`.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  const { url, publishableKey } = readSupabasePublicConfig();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies. The middleware refreshes
          // the session cookies for navigation requests, so dropping the write
          // here is safe and expected.
        }
      },
    },
  });
}
