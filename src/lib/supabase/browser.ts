import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { readSupabasePublicConfig } from "./config";

/**
 * Supabase client for Client Components. It handles interaction only — MFA
 * enrolment ceremonies and sign-out — never authorization, which is always
 * revalidated on the server.
 */
export function createSupabaseBrowserClient(): SupabaseClient {
  const { url, publishableKey } = readSupabasePublicConfig();
  return createBrowserClient(url, publishableKey);
}
