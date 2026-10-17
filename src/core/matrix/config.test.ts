import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";

import { describe, expect, it } from "vitest";

import { contentSecurityPolicy } from "@/core/security/headers";

import {
  coreUserId,
  isNamespaceUser,
  matrixConfig,
  parsePrivateKey,
} from "./config";
import {
  ATTENDANT_LOCALPART,
  LOGIN_TTL_SECONDS,
  newAttendantLocalpart,
  signLoginToken,
} from "./jwt";
import { matrixCspOrigin } from "./origin";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const ENV = {
  MATRIX_HOMESERVER_URL: "https://dev.guidu.chat/",
  MATRIX_SERVER_NAME: "dev.guidu.chat",
  MATRIX_AS_ID: "guidu-core",
  MATRIX_AS_SENDER: "_guidu_core",
  MATRIX_AS_TOKEN: "as-token",
  MATRIX_HS_TOKEN: "hs-token",
  MATRIX_JWT_ISSUER: "guidu-console",
  MATRIX_JWT_AUDIENCE: "guidu-matrix",
  // As setup.ts writes it: PEM in base64, one line.
  MATRIX_JWT_PRIVATE_KEY: Buffer.from(privateKey).toString("base64"),
};

describe("matrixConfig", () => {
  it("is off when any required variable is missing", () => {
    for (const name of [
      "MATRIX_HOMESERVER_URL",
      "MATRIX_SERVER_NAME",
      "MATRIX_AS_TOKEN",
      "MATRIX_HS_TOKEN",
      "MATRIX_JWT_PRIVATE_KEY",
    ]) {
      expect(matrixConfig({ ...ENV, [name]: "" })).toBeNull();
    }
    expect(matrixConfig({})).toBeNull();
    expect(matrixCspOrigin({})).toBeNull();
  });

  it("reads the variables of setup.ts, with the server name from the environment", () => {
    const config = matrixConfig({
      ...ENV,
      MATRIX_SERVER_NAME: "multica-synapse.dtjkix.easypanel.host",
    });
    expect(config).toMatchObject({
      homeserverUrl: "https://dev.guidu.chat",
      homeserverOrigin: "https://dev.guidu.chat",
      serverName: "multica-synapse.dtjkix.easypanel.host",
      asId: "guidu-core",
      asSender: "_guidu_core",
    });
    expect(coreUserId(config!)).toBe(
      "@_guidu_core:multica-synapse.dtjkix.easypanel.host",
    );
    expect(
      isNamespaceUser(
        config!,
        "@_guidu_agent_x:multica-synapse.dtjkix.easypanel.host",
      ),
    ).toBe(true);
    expect(
      isNamespaceUser(config!, "@u_abc:multica-synapse.dtjkix.easypanel.host"),
    ).toBe(false);
    expect(isNamespaceUser(config!, "@_guidu_agent_x:other.server")).toBe(
      false,
    );
  });

  it("accepts the raw PEM too, and refuses what is not an RSA private key", () => {
    expect(
      matrixConfig({ ...ENV, MATRIX_JWT_PRIVATE_KEY: privateKey }),
    ).not.toBeNull();
    expect(
      matrixConfig({ ...ENV, MATRIX_JWT_PRIVATE_KEY: "bm90IGEga2V5" }),
    ).toBeNull();
    const { privateKey: ec } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    expect(() => parsePrivateKey(ec)).toThrow(/RSA/);
  });

  it("refuses a sender outside the namespace and an invalid address", () => {
    expect(matrixConfig({ ...ENV, MATRIX_AS_SENDER: "admin" })).toBeNull();
    expect(
      matrixConfig({ ...ENV, MATRIX_HOMESERVER_URL: "ftp://x" }),
    ).toBeNull();
    expect(matrixConfig({ ...ENV, MATRIX_SERVER_NAME: "bad name" })).toBeNull();
  });
});

describe("CSP connect-src", () => {
  it("opens the homeserver only when Matrix is configured, https in production", () => {
    const origin = matrixCspOrigin(ENV);
    expect(origin).toBe("https://dev.guidu.chat");
    const on = contentSecurityPolicy("n", {
      production: true,
      matrixOrigin: origin,
    });
    expect(on).toContain("connect-src 'self' https://dev.guidu.chat;");
    const off = contentSecurityPolicy("n", {
      production: true,
      matrixOrigin: null,
    });
    expect(off).toContain("connect-src 'self';");
    const local = "http://127.0.0.1:8108";
    expect(
      contentSecurityPolicy("n", { production: true, matrixOrigin: local }),
    ).toContain("connect-src 'self';");
    expect(
      contentSecurityPolicy("n", { production: false, matrixOrigin: local }),
    ).toContain(`connect-src 'self' ${local};`);
    expect(
      contentSecurityPolicy("n", {
        production: false,
        matrixOrigin: "https://x.test; script-src *",
      }),
    ).toContain("connect-src 'self';");
  });
});

describe("login token", () => {
  const config = matrixConfig(ENV)!;

  it("uses opaque localparts", () => {
    const a = newAttendantLocalpart();
    const b = newAttendantLocalpart();
    expect(a).toMatch(ATTENDANT_LOCALPART);
    expect(a).not.toBe(b);
  });

  it("is RS256, expires in 60 seconds and carries only the attendant", () => {
    const now = new Date("2026-10-17T12:00:00Z");
    const localpart = newAttendantLocalpart();
    const { token, expiresAt } = signLoginToken(config, {
      localpart,
      displayName: "Ana",
      now,
    });
    const [header, payload, signature] = token.split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    const claims = JSON.parse(
      Buffer.from(payload!, "base64url").toString(),
    ) as Record<string, unknown>;
    expect(claims).toMatchObject({
      sub: localpart,
      name: "Ana",
      iss: "guidu-console",
      aud: "guidu-matrix",
      iat: now.getTime() / 1000,
      exp: now.getTime() / 1000 + LOGIN_TTL_SECONDS,
    });
    expect(expiresAt.getTime() - now.getTime()).toBe(60_000);
    const publicKey = createPublicKey(privateKey);
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${payload}`),
        publicKey,
        Buffer.from(signature!, "base64url"),
      ),
    ).toBe(true);
  });

  it("refuses the core, the agents and any non-opaque subject", () => {
    for (const localpart of [
      "_guidu_core",
      "_guidu_agent_loja",
      "admin",
      "u_A0000000",
    ]) {
      expect(() =>
        signLoginToken(config, { localpart, displayName: "x" }),
      ).toThrow(/attendant/);
    }
  });
});
