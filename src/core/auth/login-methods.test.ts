import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma/client", () => ({ prisma: {} }));
vi.mock("@/core/partners/resolve", () => ({ getRequestPartner: vi.fn() }));

import type { SqlExecutor } from "@/core/i18n/messages-loader";
import type { SettingRow } from "@/core/settings/resolve";

import { loginMethodInput } from "./login-method-input";
import {
  combineLoginMethods,
  loginMethodsFor,
  offeredLoginMethods,
  providerFlags,
} from "./login-methods";

const row = (
  scope: SettingRow["scope"],
  key: string,
  value: unknown,
): SettingRow => ({ scope, key, value, locked: false });

function fakeDb(rows: SettingRow[]) {
  const queryRaw = vi.fn(async () => rows);
  return { db: { $queryRaw: queryRaw } as unknown as SqlExecutor, queryRaw };
}

describe("login methods (CF5b)", () => {
  it("reads the provider flags only as an explicit true", () => {
    expect(providerFlags({})).toEqual({ google: false, magicLink: false });
    expect(
      providerFlags({
        AUTH_GOOGLE_ENABLED: " TRUE ",
        AUTH_MAGIC_LINK_ENABLED: "1",
      }),
    ).toEqual({ google: true, magicLink: false });
    expect(
      providerFlags({
        AUTH_GOOGLE_ENABLED: "yes",
        AUTH_MAGIC_LINK_ENABLED: "true",
      }),
    ).toEqual({ google: false, magicLink: true });
  });

  it("offers nothing by default and what the platform turns on", () => {
    expect(offeredLoginMethods([])).toEqual({
      google: false,
      magicLink: false,
    });
    expect(offeredLoginMethods([row("platform", "auth.google", true)])).toEqual(
      { google: true, magicLink: false },
    );
    // The partner hides it; it can never turn on what the platform did not.
    expect(
      offeredLoginMethods([
        row("platform", "auth.google", true),
        row("partner", "auth.google", false),
        row("partner", "auth.magic_link", true),
      ]),
    ).toEqual({ google: false, magicLink: false });
  });

  it("shows a method only with the provider on and the cascade offering it", () => {
    const all = { google: true, magicLink: true };
    const none = { google: false, magicLink: false };
    expect(combineLoginMethods(all, none)).toEqual(none);
    expect(combineLoginMethods(none, all)).toEqual(none);
    expect(
      combineLoginMethods(
        { google: true, magicLink: false },
        { google: true, magicLink: true },
      ),
    ).toEqual({ google: true, magicLink: false });
  });

  it("does not read the settings while no provider is on", async () => {
    const { db, queryRaw } = fakeDb([row("platform", "auth.google", true)]);
    expect(await loginMethodsFor(db, null, {})).toEqual({
      google: false,
      magicLink: false,
    });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("reads the host partner's rows when a provider is on", async () => {
    const { db, queryRaw } = fakeDb([
      row("platform", "auth.google", true),
      row("platform", "auth.magic_link", true),
      row("partner", "auth.magic_link", false),
    ]);
    expect(
      await loginMethodsFor(db, "partner-1", {
        AUTH_GOOGLE_ENABLED: "true",
        AUTH_MAGIC_LINK_ENABLED: "true",
      }),
    ).toEqual({ google: true, magicLink: false });
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(queryRaw.mock.calls[0]).toContain("partner-1");
  });
});

describe("loginMethodInput (CF5b)", () => {
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  };

  it("lets the platform offer a method or go back to the default", () => {
    expect(
      loginMethodInput("platform", form({ method: "google", enabled: "on" })),
    ).toEqual({ values: { "auth.google": true } });
    expect(loginMethodInput("platform", form({ method: "magicLink" }))).toEqual(
      { values: { "auth.magic_link": null } },
    );
  });

  it("lets the partner only hide a method or keep the platform's", () => {
    expect(loginMethodInput("partner", form({ method: "google" }))).toEqual({
      values: { "auth.google": false },
    });
    expect(
      loginMethodInput("partner", form({ method: "magicLink", enabled: "on" })),
    ).toEqual({ values: { "auth.magic_link": null } });
  });

  it("refuses an unknown method", () => {
    expect(loginMethodInput("platform", form({ method: "saml" }))).toBeNull();
    expect(loginMethodInput("partner", form({}))).toBeNull();
    expect(
      loginMethodInput("platform", form({ method: "toString" })),
    ).toBeNull();
  });
});
