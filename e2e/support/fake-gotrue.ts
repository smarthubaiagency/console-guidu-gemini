import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";

import { signAccessToken } from "./jwt";
import { generateBase32Secret, totpMatches } from "./totp";

/**
 * Auth test double for the end-to-end suite.
 *
 * It speaks the subset of the GoTrue HTTP API that `@supabase/ssr` uses for
 * password sign-in, recovery, logout and TOTP MFA, so the specs drive the real
 * application code — cookie handling, `getClaims` validation, the `aal` claim
 * — without Docker, which this environment does not have. The hosted Auth
 * server is never a dependency of the suite, and no production credential is
 * involved.
 *
 * It is a double, not a replica: rate limits, e-mail delivery, password policy
 * and token rotation details are out of scope. The authoritative replay of the
 * migration chain and the RLS proof live in the CI `db` job.
 */

const JWT_SECRET = "e2e-fake-gotrue-secret";
const TOKEN_TTL_SECONDS = 3600;

type Factor = {
  id: string;
  friendly_name: string;
  factor_type: "totp";
  status: "verified" | "unverified";
  secret: string;
  created_at: string;
  updated_at: string;
};

type FakeUser = {
  id: string;
  email: string;
  password: string;
  factors: Factor[];
};

type IssuedToken = {
  userId: string;
  aal: "aal1" | "aal2";
  refreshToken: string;
  revoked: boolean;
};

export type FakeGoTrue = Readonly<{
  url: string;
  close: () => Promise<void>;
}>;

export type FakeGoTrueOptions = Readonly<{
  port: number;
  /** Called when a user is created, so the harness can mirror `auth.users`. */
  onUserCreated: (
    user: Readonly<{ id: string; email: string }>,
  ) => Promise<void>;
  /** Called by the block control endpoint; the harness owns the database. */
  onBlockIdentity: (email: string) => Promise<void>;
  /** `count(*)` of profile rows for an identity, for the provisioning checks. */
  onCountProfiles: (email: string) => Promise<number>;
  /** Seeds user as platform admin in platform_admin_members table. */
  onMakePlatformAdmin: (email: string) => Promise<void>;
  /** Seeds workspace and membership in database. */
  onSeedWorkspace: (params: {
    email: string;
    orgName: string;
    orgSlug: string;
    wsName: string;
    wsSlug: string;
    role?: "owner" | "admin" | "member";
  }) => Promise<{ organizationId: string; workspaceId: string }>;
}>;

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        resolve({});
      }
    });
  });
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function startFakeGoTrue(
  options: FakeGoTrueOptions,
): Promise<FakeGoTrue> {
  const users = new Map<string, FakeUser>();
  const tokens = new Map<string, IssuedToken>();
  const refreshTokens = new Map<string, string>();
  const recoveryTokens = new Map<string, string>();
  const challenges = new Map<string, string>();

  const findByEmail = (email: string): FakeUser | undefined =>
    [...users.values()].find(
      (user) => user.email.toLowerCase() === email.toLowerCase(),
    );

  const userBody = (user: FakeUser) => ({
    id: user.id,
    aud: "authenticated",
    role: "authenticated",
    email: user.email,
    email_confirmed_at: new Date(0).toISOString(),
    phone: "",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
    // The shared secret stays server-side, as it does in a real project.
    factors: user.factors.map((factor) => ({
      id: factor.id,
      friendly_name: factor.friendly_name,
      factor_type: factor.factor_type,
      status: factor.status,
      created_at: factor.created_at,
      updated_at: factor.updated_at,
    })),
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  });

  const issueSession = (user: FakeUser, aal: "aal1" | "aal2") => {
    const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
    const accessToken = signAccessToken(
      {
        sub: user.id,
        email: user.email,
        aud: "authenticated",
        role: "authenticated",
        aal,
        session_id: randomUUID(),
        iat: Math.floor(Date.now() / 1000),
        exp: expiresAt,
      },
      JWT_SECRET,
    );
    const refreshToken = randomUUID();

    tokens.set(accessToken, {
      userId: user.id,
      aal,
      refreshToken,
      revoked: false,
    });
    refreshTokens.set(refreshToken, accessToken);

    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: TOKEN_TTL_SECONDS,
      expires_at: expiresAt,
      refresh_token: refreshToken,
      user: userBody(user),
    };
  };

  const bearer = (request: IncomingMessage): IssuedToken | null => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) return null;
    const issued = tokens.get(header.slice("Bearer ".length));
    if (!issued || issued.revoked) return null;
    return issued;
  };

  const revokeAllFor = (userId: string): void => {
    for (const issued of tokens.values()) {
      if (issued.userId === userId) issued.revoked = true;
    }
  };

  const server: Server = createServer((request, response) => {
    void handle(request, response).catch((err) => {
      console.error("FAKE GOTRUE ERROR:", err);
      return json(response, 500, { msg: "fake gotrue failure", error: String(err) });
    });
  });

  async function handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const path = url.pathname.replace(/^\/auth\/v1/, "");
    const method = request.method ?? "GET";

    // ---- test control surface -------------------------------------------
    if (path === "/__control/users" && method === "POST") {
      const body = await readBody(request);
      const email = asString(body.email);
      const password = asString(body.password);
      if (!email || !password) return json(response, 400, { msg: "invalid" });

      const user: FakeUser = {
        id: randomUUID(),
        email,
        password,
        factors: [],
      };
      users.set(user.id, user);
      await options.onUserCreated({ id: user.id, email: user.email });
      return json(response, 201, { id: user.id, email: user.email });
    }

    if (path === "/__control/recovery" && method === "GET") {
      const email = url.searchParams.get("email") ?? "";
      const token = recoveryTokens.get(email.toLowerCase());
      if (!token) return json(response, 404, { msg: "no recovery token" });
      return json(response, 200, { token_hash: token });
    }

    if (path === "/__control/profiles" && method === "GET") {
      const email = url.searchParams.get("email") ?? "";
      return json(response, 200, {
        count: await options.onCountProfiles(email),
      });
    }

    if (path === "/__control/block" && method === "POST") {
      const body = await readBody(request);
      const email = asString(body.email);
      if (!email) return json(response, 400, { msg: "invalid" });
      await options.onBlockIdentity(email);
      return json(response, 200, { blocked: email });
    }

    if (path === "/__control/platform-admin" && method === "POST") {
      const body = await readBody(request);
      const email = asString(body.email);
      if (!email) return json(response, 400, { msg: "invalid" });
      await options.onMakePlatformAdmin(email);
      return json(response, 200, { admin: email });
    }

    if (path === "/__control/seed-workspace" && method === "POST") {
      const body = await readBody(request);
      const email = asString(body.email);
      const orgName = asString(body.orgName) ?? "Empresa Teste";
      const orgSlug = asString(body.orgSlug) ?? `org-${Date.now()}`;
      const wsName = asString(body.wsName) ?? "Workspace Teste";
      const wsSlug = asString(body.wsSlug) ?? `ws-${Date.now()}`;
      const role = asString(body.role) as "owner" | "admin" | "member" | null;
      if (!email) return json(response, 400, { msg: "invalid email" });
      const seeded = await options.onSeedWorkspace({
        email,
        orgName,
        orgSlug,
        wsName,
        wsSlug,
        role: role ?? "owner",
      });
      return json(response, 200, seeded);
    }

    // ---- gotrue ---------------------------------------------------------
    if (path === "/token" && method === "POST") {
      const grant = url.searchParams.get("grant_type");
      const body = await readBody(request);

      if (grant === "password") {
        const email = asString(body.email);
        const password = asString(body.password);
        const user = email ? findByEmail(email) : undefined;
        if (!user || user.password !== password) {
          return json(response, 400, {
            code: 400,
            error_code: "invalid_credentials",
            msg: "Invalid login credentials",
          });
        }
        return json(response, 200, issueSession(user, "aal1"));
      }

      if (grant === "refresh_token") {
        const provided = asString(body.refresh_token);
        const previousAccess = provided
          ? refreshTokens.get(provided)
          : undefined;
        const previous = previousAccess
          ? tokens.get(previousAccess)
          : undefined;
        const user = previous ? users.get(previous.userId) : undefined;
        if (!previous || previous.revoked || !user) {
          return json(response, 400, {
            code: 400,
            error_code: "refresh_token_not_found",
            msg: "Invalid Refresh Token",
          });
        }
        return json(response, 200, issueSession(user, previous.aal));
      }

      return json(response, 400, {
        code: 400,
        error_code: "unsupported_grant_type",
        msg: `grant_type ${grant} not implemented by the test double`,
      });
    }

    if (path === "/user" && method === "GET") {
      const issued = bearer(request);
      const user = issued ? users.get(issued.userId) : undefined;
      if (!user)
        return json(response, 401, { code: 401, msg: "invalid claim" });
      return json(response, 200, userBody(user));
    }

    if (path === "/user" && method === "PUT") {
      const issued = bearer(request);
      const user = issued ? users.get(issued.userId) : undefined;
      if (!user)
        return json(response, 401, { code: 401, msg: "invalid claim" });

      const body = await readBody(request);
      const password = asString(body.password);
      if (password) user.password = password;
      return json(response, 200, userBody(user));
    }

    if (path === "/logout" && method === "POST") {
      const issued = bearer(request);
      if (issued) revokeAllFor(issued.userId);
      response.writeHead(204);
      response.end();
      return;
    }

    if (path === "/recover" && method === "POST") {
      const body = await readBody(request);
      const email = asString(body.email);
      // Always 200: the real server does not disclose whether the address
      // exists, and neither does the double.
      if (email && findByEmail(email)) {
        recoveryTokens.set(email.toLowerCase(), randomUUID());
      }
      return json(response, 200, {});
    }

    if (path === "/verify" && method === "POST") {
      const body = await readBody(request);
      const type = asString(body.type);
      const tokenHash = asString(body.token_hash);
      const entry = [...recoveryTokens.entries()].find(
        ([, token]) => token === tokenHash,
      );
      const user = entry ? findByEmail(entry[0]) : undefined;

      if (type !== "recovery" || !entry || !user) {
        return json(response, 401, {
          code: 401,
          error_code: "otp_expired",
          msg: "Email link is invalid or has expired",
        });
      }

      // Single use.
      recoveryTokens.delete(entry[0]);
      return json(response, 200, issueSession(user, "aal1"));
    }

    if (path === "/factors" && method === "POST") {
      const issued = bearer(request);
      const user = issued ? users.get(issued.userId) : undefined;
      if (!user)
        return json(response, 401, { code: 401, msg: "invalid claim" });

      const body = await readBody(request);
      const factor: Factor = {
        id: randomUUID(),
        friendly_name: asString(body.friendly_name) ?? "TOTP",
        factor_type: "totp",
        status: "unverified",
        secret: generateBase32Secret(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      user.factors.push(factor);

      return json(response, 200, {
        id: factor.id,
        type: "totp",
        friendly_name: factor.friendly_name,
        totp: {
          qr_code: "",
          secret: factor.secret,
          uri: `otpauth://totp/GUIDU:${encodeURIComponent(user.email)}?secret=${factor.secret}&issuer=GUIDU`,
        },
      });
    }

    const factorMatch = /^\/factors\/([^/]+)\/(challenge|verify)$/.exec(path);
    if (factorMatch && method === "POST") {
      const [, factorId, operation] = factorMatch;
      const issued = bearer(request);
      const user = issued ? users.get(issued.userId) : undefined;
      const factor = user?.factors.find(
        (candidate) => candidate.id === factorId,
      );
      if (!user || !factor) {
        return json(response, 401, { code: 401, msg: "invalid claim" });
      }

      if (operation === "challenge") {
        const challengeId = randomUUID();
        challenges.set(challengeId, factor.id);
        return json(response, 200, {
          id: challengeId,
          type: "totp",
          expires_at: Math.floor(Date.now() / 1000) + 300,
        });
      }

      const body = await readBody(request);
      const challengeId = asString(body.challenge_id);
      const code = asString(body.code);
      if (
        !challengeId ||
        challenges.get(challengeId) !== factor.id ||
        !code ||
        !totpMatches(factor.secret, code)
      ) {
        return json(response, 400, {
          code: 400,
          error_code: "mfa_verification_failed",
          msg: "Invalid TOTP code entered",
        });
      }

      challenges.delete(challengeId);
      factor.status = "verified";
      factor.updated_at = new Date().toISOString();
      return json(response, 200, issueSession(user, "aal2"));
    }

    const unenrolMatch = /^\/factors\/([^/]+)$/.exec(path);
    if (unenrolMatch && method === "DELETE") {
      const issued = bearer(request);
      const user = issued ? users.get(issued.userId) : undefined;
      if (!user)
        return json(response, 401, { code: 401, msg: "invalid claim" });
      user.factors = user.factors.filter(
        (factor) => factor.id !== unenrolMatch[1],
      );
      return json(response, 200, { id: unenrolMatch[1] });
    }

    return json(response, 404, {
      code: 404,
      msg: `${method} ${path} not implemented by the test double`,
    });
  }

  await new Promise<void>((resolve) =>
    server.listen(options.port, "127.0.0.1", resolve),
  );

  return {
    url: `http://127.0.0.1:${options.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
