import "server-only";

import { cache } from "react";

import type { SqlExecutor } from "@/core/i18n/messages-loader";
import { getRequestPartner } from "@/core/partners/resolve";
import { resolveSettings, type SettingRow } from "@/core/settings/resolve";
import { prisma } from "@/lib/prisma/client";
import { appLog } from "@/lib/telemetry/log";

/**
 * Sign-in methods offered on the login page besides e-mail and password
 * (CF5b). A method shows only when both are true:
 *
 * 1. Operations switched the provider on in Supabase Auth and said so in
 *    the environment (`AUTH_GOOGLE_ENABLED=true`,
 *    `AUTH_MAGIC_LINK_ENABLED=true`, docs/operacao/autenticacao.md). The
 *    dashboard never changes Supabase Auth itself.
 * 2. The cascade offers it to the host: the platform turns it on and the
 *    host's partner did not turn it off (`auth.google`, `auth.magic_link`).
 *
 * The page hides the buttons; the actions check again on the server.
 */

export type LoginMethod = "google" | "magicLink";

export type LoginMethods = Readonly<Record<LoginMethod, boolean>>;

export const NO_LOGIN_METHODS: LoginMethods = {
  google: false,
  magicLink: false,
};

type Env = Readonly<Record<string, string | undefined>>;

function isOn(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

/** Providers operations declared on in Supabase Auth. */
export function providerFlags(env: Env = process.env): LoginMethods {
  return {
    google: isOn(env.AUTH_GOOGLE_ENABLED),
    magicLink: isOn(env.AUTH_MAGIC_LINK_ENABLED),
  };
}

/** What the cascade offers to the host, from its `auth.*` rows. */
export function offeredLoginMethods(rows: readonly SettingRow[]): LoginMethods {
  const { values } = resolveSettings(rows);
  return {
    google: values["auth.google"],
    magicLink: values["auth.magic_link"],
  };
}

/** A method shows when the provider is on and the cascade offers it. */
export function combineLoginMethods(
  providers: LoginMethods,
  offered: LoginMethods,
): LoginMethods {
  return {
    google: providers.google && offered.google,
    magicLink: providers.magicLink && offered.magicLink,
  };
}

/** `auth.*` rows of the platform and of one partner (null: platform only). */
export async function readLoginSettings(
  db: SqlExecutor,
  partnerId: string | null,
): Promise<SettingRow[]> {
  return db.$queryRaw<SettingRow[]>`
    select scope, key, value, locked
    from private.auth_login_settings(${partnerId}::uuid)
  `;
}

/** Methods of one partner's hosts (null: the platform's values alone). */
export async function loginMethodsFor(
  db: SqlExecutor,
  partnerId: string | null,
  env: Env = process.env,
): Promise<LoginMethods> {
  const providers = providerFlags(env);
  // No provider on: nothing to read.
  if (!providers.google && !providers.magicLink) return NO_LOGIN_METHODS;
  return combineLoginMethods(
    providers,
    offeredLoginMethods(await readLoginSettings(db, partnerId)),
  );
}

/**
 * Methods of the current request host, once per request. A failure to read
 * the settings hides the extra methods: e-mail and password keep working.
 */
export const requestLoginMethods = cache(async (): Promise<LoginMethods> => {
  try {
    const partner = await getRequestPartner();
    return await loginMethodsFor(prisma, partner?.partnerId ?? null);
  } catch (err) {
    appLog.warn("auth.login_methods_unavailable", {
      error: err instanceof Error ? err.name : "unknown",
    });
    return NO_LOGIN_METHODS;
  }
});
