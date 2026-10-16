import { createFakeGoogleBusinessProvider } from "./fake";
import {
  type GoogleBusinessProvider,
  GoogleBusinessNotConfiguredError,
} from "./port";
import { createZernioProvider } from "./zernio";

/**
 * The Google Business provider of the environment (GB1a):
 * `GOOGLE_BUSINESS_PROVIDER=fake` in tests and e2e (refused in production),
 * else Zernio with `ZERNIO_API_KEY` and `ZERNIO_PROFILE_ID`. Without them
 * the connection is off and the screens say so.
 */

type Env = Readonly<Record<string, string | undefined>>;

export function isFakeGoogleBusinessProvider(env: Env = process.env): boolean {
  return env.GOOGLE_BUSINESS_PROVIDER?.trim() === "fake";
}

export function isGoogleBusinessConfigured(env: Env = process.env): boolean {
  return (
    isFakeGoogleBusinessProvider(env) ||
    Boolean(env.ZERNIO_API_KEY?.trim() && env.ZERNIO_PROFILE_ID?.trim())
  );
}

export function googleBusinessProvider(
  env: Env = process.env,
): GoogleBusinessProvider {
  if (isFakeGoogleBusinessProvider(env)) {
    return createFakeGoogleBusinessProvider(
      env.APP_URL?.trim() || "http://localhost",
    );
  }
  const apiKey = env.ZERNIO_API_KEY?.trim();
  const profileId = env.ZERNIO_PROFILE_ID?.trim();
  if (!apiKey || !profileId) throw new GoogleBusinessNotConfiguredError();
  return createZernioProvider({ apiKey, profileId });
}
