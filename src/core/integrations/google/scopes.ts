import { z } from "zod";

/**
 * Google scopes of the integration (CF6b, plano G1): the minimum each tool
 * needs. `drive.file` reaches only the files the customer picks,
 * `spreadsheets` the sheets, `calendar.events` the events of the calendars.
 * The platform turns them on, the partner may only narrow them for its
 * customers (`integrations.google.scopes`, a "narrow" key of ADR 0018).
 */

export const GOOGLE_SCOPES = [
  "drive.file",
  "spreadsheets",
  "calendar.events",
] as const;

export type GoogleScope = (typeof GOOGLE_SCOPES)[number];

export const GoogleScopeSchema = z.enum(GOOGLE_SCOPES);

export const GoogleScopesSchema = z
  .array(GoogleScopeSchema)
  .max(GOOGLE_SCOPES.length)
  .refine((list) => new Set(list).size === list.length, "repeated scope");

/** OAuth scope URL of each scope. */
export const GOOGLE_SCOPE_URLS: Readonly<Record<GoogleScope, string>> = {
  "drive.file": "https://www.googleapis.com/auth/drive.file",
  spreadsheets: "https://www.googleapis.com/auth/spreadsheets",
  "calendar.events": "https://www.googleapis.com/auth/calendar.events",
};

/** Identity scopes asked with every connection (the account's e-mail). */
export const GOOGLE_IDENTITY_SCOPES = ["openid", "email"] as const;

/** The level below keeps only what the level above offers, in order. */
export function narrowGoogleScopes(
  above: readonly GoogleScope[],
  below: readonly GoogleScope[],
): GoogleScope[] {
  return GOOGLE_SCOPES.filter(
    (scope) => above.includes(scope) && below.includes(scope),
  );
}

/** Our scope ids from the scope URLs Google granted. */
export function scopesFromGrant(granted: string): GoogleScope[] {
  const urls = granted.split(/\s+/).filter(Boolean);
  return GOOGLE_SCOPES.filter((scope) =>
    urls.includes(GOOGLE_SCOPE_URLS[scope]),
  );
}

export function isGoogleScope(value: string): value is GoogleScope {
  return (GOOGLE_SCOPES as readonly string[]).includes(value);
}
