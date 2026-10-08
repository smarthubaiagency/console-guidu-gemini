# MCP over the Supabase OAuth 2.1 Server (SMA-93)

Verdict: **Supabase + complement.** Supabase can be the authorization server for
the MCP surfaces, but it cannot carry the per-surface authorization by itself.
It issues no custom scopes and it does not bind the token to the `resource`,
so the application must own the grant table, the RFC 9728 metadata and the
per-request revocation check. Nothing here requires a home-made OAuth server.

The one thing the spike could not execute end to end is the consent leg, because
Supabase delegates the consent screen to the application and its consent API is
behind the project apikey, which agents cannot read. See
[Not verified](#not-verified).

## Environment

- Dev project `guidu` (`mmwmhlafzewdyqsgfkzk`, sa-east-1), **Authentication >
  OAuth Server** and Dynamic Client Registration enabled by Marcelo on
  2026-10-07. Before that every OAuth route answered
  `404 error_code=feature_disabled`.
- Issuer: `https://mmwmhlafzewdyqsgfkzk.supabase.co/auth/v1`.
- Probes run 2026-10-08, from `tests/mcp-oauth/`, Node 24.21.0, Vitest 5.0.3.
- MCP specification revisions read: `2026-07-28` (current) and `2025-11-25`.
- `@modelcontextprotocol/sdk` 1.32.1, published 2026-10-05 (only dist-tag:
  `latest`).

Reproduce the live half with:

```
GUIDU_OAUTH_LIVE=1 npm test -- tests/mcp-oauth
```

Without the flag the live file is skipped and **16 offline checks** still run, so
the default suite needs no network and writes nothing. The **22 live probes**
were run once, on 2026-10-08 at commit `495ffde`; they are not re-run on every
change because each run registers an OAuth client in `guidu` that has to be
cleaned up by hand. `console-guidu` has no CI workflow yet, so the evidence here
is the local run, not a pipeline link.

Cleanup: every client the probes registered was soft-deleted afterwards and the
pending authorizations were removed. `auth.oauth_clients` has no active row,
`auth.oauth_authorizations`, `auth.oauth_consents` and `auth.users` are all
empty, so `guidu` is back to the state it was handed over in.

## Requirement matrix

| # | Section 17 requirement | Verdict | Evidence |
|---|---|---|---|
| 1 | Authorization Code + PKCE, authorization server metadata | **Meets** | `tests/mcp-oauth/supabase-oauth-server.live.test.ts:99` |
| 1 | Protected resource metadata (RFC 9728) | **Does not meet — not Supabase's job** | Supabase serves no `oauth-protected-resource`; the MCP server must. `src/mcp/resource-server.ts:87` |
| 2 | Token bound to `/mcp/workspace` vs `/mcp/admin` (audience / resource indicator) | **Partial** | `resource` is validated and stored at `/authorize`, absent from the token. `tests/mcp-oauth/supabase-oauth-server.live.test.ts:188`, `tests/mcp-oauth/resource-server.test.ts:108` |
| 3 | Custom scopes (`workspace:read`, `modules:read`) | **Does not meet** | `unsupported scope: workspace:read`. `tests/mcp-oauth/supabase-oauth-server.live.test.ts:174` |
| 4 | Pre-registered clients and DCR | **Meets** | `tests/mcp-oauth/supabase-oauth-server.live.test.ts:344` |
| 4 | Client ID Metadata Documents | **Does not meet** | `oauth_client_not_found: invalid client_id format`. `tests/mcp-oauth/supabase-oauth-server.live.test.ts:262` |
| 5 | Revocation (RFC 7009 endpoint) | **Does not meet** | No `revocation_endpoint`, no `introspection_endpoint`. `tests/mcp-oauth/supabase-oauth-server.live.test.ts:126` |
| 5 | Application resolves its own grant from the token | **Meets, by application code** | `sub` + `client_id` → `mcp_grants`. `src/mcp/resource-server.ts:218` |
| 6 | One target protocol version and the matching TypeScript SDK | **Answered** | `2025-11-25` with `@modelcontextprotocol/sdk` ^1.32.1. [Item 6](#6-protocol-version-and-sdk) |
| 7 | Local proof of concept with a `get_workspace` tool | **Partial** | Resource server and tool run against a Supabase-shaped token; no live client leg. [Item 7](#7-proof-of-concept) |

## 1. Authorization Code + PKCE and discovery

`GET /auth/v1/.well-known/oauth-authorization-server` answers `200` with
`grant_types_supported: ["authorization_code","refresh_token"]`,
`response_types_supported: ["code"]` and `code_challenge_methods_supported:
["S256","plain"]`. The implicit flow is refused (`only response_type=code is
supported`) and `client_credentials` is refused
(`unsupported_grant_type`). A public client without PKCE is refused with
`PKCE flow requires both code_challenge and code_challenge_method`. An
unregistered `redirect_uri` is refused with `400 validation_failed` before any
redirect, which is the correct open-redirection posture.

The JWKS publishes an **ES256** key, so an MCP client can validate tokens from
`/.well-known/jwks.json` without the project JWT secret. MCP requires asymmetric
signing in practice for ID tokens, and this project already satisfies it.

Three gaps, none of them blocking:

- **`plain` PKCE is still advertised.** OAuth 2.1 §4.1.1 requires `S256`, and a
  `plain` challenge is accepted by `/authorize` in practice. The risk is on the
  client side; our own clients must send `S256`.
- **No RFC 9207 `iss`.** `authorization_response_iss_parameter_supported` is
  absent from the metadata and no `iss` appears on error redirects. MCP
  `2026-07-28` makes `iss` a SHOULD for authorization servers, so a client that
  recorded the expected issuer simply proceeds; nothing breaks.
- **Protected resource metadata is ours to serve.** Supabase is the
  authorization server, not the resource server. `metadataUrl()` in
  `src/mcp/resource-server.ts:101` builds
  `https://<host>/.well-known/oauth-protected-resource/mcp/workspace`, the
  path-inserted form both revisions require.

## 2. Resource binding for `/mcp/workspace` and `/mcp/admin`

This is the finding that shapes the design.

**What works.** `/authorize` implements the RFC 8707 `resource` parameter and
validates it: `nao-uri` is refused with `resource must be an absolute URI`,
`https://console.guidu.test/mcp#frag` with `resource must not include a fragment
component`, and a canonical URI is accepted and persisted. A probe with
`resource=https://console.guidu.test/mcp/workspace` produced an
`auth.oauth_authorizations` row carrying exactly that value in its `resource`
column. When two `resource` parameters are sent, only the first is kept — fine
for MCP, which demands exactly one, but silent.

**What does not work.** The value never reaches the token. The documented access
token claim set is `aud: "authenticated"` plus the standard Supabase session
claims, and the only OAuth-specific addition is `client_id`; there is no
`resource` claim and no audience claim naming the surface
([OAuth flows, "Access token structure"](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows)).
Consistently with that, `/oauth/token` does not even parse the parameter: the
same malformed `resource=nao-uri` that `/authorize` rejects is ignored there,
and the request fails only on the authorization code.

Both MCP revisions make this a MUST on the resource server:

> MCP servers **MUST** validate that access tokens were issued specifically for
> them as the intended audience, according to RFC 8707 Section 2.

Run against a Supabase-shaped token, strict RFC 8707 validation fails, and it
fails *identically* on both surfaces — the proof that nothing in the token
distinguishes `/mcp/workspace` from `/mcp/admin`
(`tests/mcp-oauth/resource-server.test.ts:108` and `:122`).

**Why this is still workable.** The `2025-11-25` revision states the requirement
with an explicit alternative — tokens must include the server in the audience
claim *"or otherwise verify that they are the intended recipient of the token"* —
and notes that RFC 8707 binds tokens *"when the Authorization Server supports the
capability"*. So a resource server that establishes the intended recipient by
another means is inside the specification. The spike implements that means as
`audienceBinding: "grant-table"`: the surface and the application scopes come
from the application's own `mcp_grants` row, keyed by the token's `sub` and
`client_id`. With it, the same token is accepted on `/mcp/workspace` and
answered `403 insufficient_scope` on `/mcp/admin`
(`tests/mcp-oauth/resource-server.test.ts:145` and `:162`).

**The consequence nobody should discover later.** The docs state that "all OAuth
access tokens have full access to user data (same as regular session tokens),
with the addition of the `client_id` claim". An MCP access token is therefore a
full Supabase session token: a client that obtained one for `/mcp/workspace` can
skip the MCP server and call the Data API, PostgREST and Storage directly as
`authenticated`. The grant table protects the MCP surfaces, not the database.

What neutralises that is already decided and already proven:
[ADR 0001](../adr/0001-prisma-como-caminho-unico.md) closes the Data API for
domain tables — `anon` and `authenticated` hold no grants on them, verified in
[`prisma-rls.md`](./prisma-rls.md) — so a session token reaches no domain row
regardless of its claims. The same ADR puts every domain query behind Prisma as
`app_runtime`, with the policies reading **only** the `app.*` context set by
`set_config`; it explicitly rejects RLS driven by JWT claims. So `client_id` does
not belong in a policy. The MCP server's job is to turn the token into that
context: verify the signature, resolve `(sub, client_id, resource)` to an
`mcp_grants` row, then open the transaction with `app.user_id`,
`app.workspace_id`, `app.organization_id`, `app.principal_type` and
`app.grant_id` from the grant — `grantId` already exists in
`src/db/with-context.ts:8` for this. A request whose token carries no grant
produces no context, and no context denies access.

## 3. Custom scopes

**Does not meet, and it is a hard refusal, not a silent drop.**
`scope=openid workspace:read` is refused at `/authorize` with
`error=invalid_request`, `error_description=unsupported scope: workspace:read`.
The metadata advertises exactly `openid`, `profile`, `email`, `phone`,
`offline_access`, and the Supabase docs say custom scopes "are not currently
supported … planned for a future release".

`auth.oauth_clients` has no scope column at all, and `auth.oauth_consents.scopes`
only ever holds the OIDC set. So neither the token nor Supabase's own consent
record can express `workspace:read`. Application scopes must live in
`mcp_grants` and be enforced by the MCP server, which is what the PoC does.

A second-order effect: the MCP consent screen will show the user OIDC scopes
while the real permission being granted is an application scope. Our
application-hosted consent page has to render the `mcp_grants` scopes it is about
to create, not the `scope` parameter Supabase passes along.

## 4. Client registration

- **Dynamic Client Registration: works, and it is open.**
  `POST /auth/v1/oauth/clients/register` answered `201` with **no project
  apikey, no bearer token and no credential of any kind**. The route is exempt
  from the project apikey gate, so anyone on the internet can create clients in
  the project. Supabase's own documentation flags this ("Dynamic registration
  allows any MCP client to register with your project"). For production this
  needs a decision from Marcelo: either keep it off and pre-register clients, or
  accept the abuse surface with monitoring on `auth.oauth_clients`.
- **Pre-registration: available** through `supabase/config.toml`
  (`allow_dynamic_registration` is the DCR toggle) and the dashboard.
- **Client ID Metadata Documents: not supported.** An HTTPS URL as `client_id`
  is refused with `400 oauth_client_not_found: invalid client_id format`;
  `client_id` must be a UUID. Both MCP revisions make CIMD a SHOULD and
  `2026-07-28` **deprecates DCR** in favour of it, so this is the item most
  likely to age badly. Supabase also omits
  `client_id_metadata_document_supported` from its metadata, which is exactly
  the signal that makes conformant clients fall back to DCR — so clients
  degrade correctly today.
- **Registration response is lossy.** A requested `scope` and `policy_uri` are
  dropped from both the response and the schema; `client_uri` and `logo_uri` are
  kept. No `registration_access_token` and no `registration_client_uri` are
  issued, so there is no RFC 7592 client configuration endpoint: a registered
  client cannot be read, updated or deleted by its creator.
- **Client authentication** is limited to `none`, `client_secret_basic` and
  `client_secret_post`. `private_key_jwt` is refused, which also closes the CIMD
  private-key path.

## 5. Revocation and resolving our own grant

**No RFC 7009 and no RFC 7662.** The metadata advertises neither
`revocation_endpoint` nor `introspection_endpoint`, and unlike the rest of the
OAuth surface `/oauth/revoke` and `/oauth/introspect` are not even exempt from
the project apikey gate — they are not part of the published OAuth server
surface. Revocation is user-facing only, through
`supabase.auth.oauth.revokeGrant(clientId)`, which invalidates the client's
sessions and refresh tokens and sets `auth.oauth_consents.revoked_at`.

That leaves one sharp edge: **access tokens are stateless JWTs valid until
`exp`** (3600 s by default). Revoking a grant stops refreshes, it does not stop
a token already in an agent's hands. An MCP server that only verifies the
signature keeps serving a revoked client for up to an hour.

So the resolution path is, per request:

1. verify the signature against the Supabase JWKS and the `iss`, reject on
   failure with `401` and a `WWW-Authenticate` challenge;
2. read `sub` (the user) and `client_id` (the MCP client) — the only two claims
   that identify the grant;
3. look up `mcp_grants` by `(sub, client_id, resource)`;
4. reject when there is no row, **or when `revoked_at` is set**, even though the
   JWT is still valid;
5. compare `mcp_grants.scopes` against the scopes the surface requires and
   answer `403 insufficient_scope` with the missing ones;
6. only then touch data, through `withContext` with `app.grant_id` and the
   workspace and organization taken from the grant row — the ADR 0001 path, not
   the token.

Steps 4 and 5 are covered by `tests/mcp-oauth/resource-server.test.ts:192` and
`:162`. Step 4 is the compensating control for the missing revocation endpoint,
and it is the reason `mcp_grants` must be read on every call rather than cached
for the token lifetime.

`session_id` is also present in the token and is worth storing on the grant for
audit, but it cannot be used for revocation: nothing lets the resource server
ask Supabase whether a session is still alive.

## 6. Protocol version and SDK

**Fix `2025-11-25`, with `@modelcontextprotocol/sdk` ^1.32.1.**

The issue's two dates are not two components to mix: MCP uses a single
`YYYY-MM-DD` version string for the whole protocol, authorization and transport
together. `2026-07-28` is the current revision. The recommendation is still the
older one, for one decisive reason:

```
# @modelcontextprotocol/sdk@1.32.1/dist/esm/types.js
LATEST_PROTOCOL_VERSION = '2025-11-25'
SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25','2025-06-18','2025-03-26','2024-11-05','2024-10-07']
```

The official TypeScript SDK at its newest published version (1.32.1, 2026-10-05,
no `next` dist-tag) does not implement `2026-07-28` at all. Targeting it would
mean hand-writing the `server/discover` RPC, the
`io.modelcontextprotocol/protocolVersion` `_meta` key and
`UnsupportedProtocolVersionError` — a home-made protocol layer, against the same
instinct as a home-made OAuth server.

Picking `2025-11-25` costs nothing on the authorization side: every requirement
quoted in this document is normative in both revisions, including the audience
MUST, the RFC 9728 MUST and the PKCE `S256` MUST. What `2026-07-28` adds that
matters to us is the CIMD-over-DCR shift, which Supabase cannot serve anyway
(item 4). Revisit when the SDK ships `2026-07-28`; the migration is transport
and handshake, not authorization.

Supabase also publishes `@supabase/server` 1.9.1 and `@supabase/middleware`
1.0.0, whose `withOAuthProtectedResource()` emits the protected resource
metadata and the `WWW-Authenticate` challenge. Worth evaluating in F4 as a
replacement for `src/mcp/resource-server.ts`, but it will not close the audience
gap, which is a property of the token.

## 7. Proof of concept

Built, and it runs — on the resource-server side only.

`src/mcp/resource-server.ts` serves two surfaces, emits RFC 9728 metadata and
the `WWW-Authenticate` challenges, and exposes the fictional `get_workspace`
tool from the issue. `tests/mcp-oauth/resource-server.test.ts` drives it with
ES256 tokens minted from a throwaway key and shaped exactly like a documented
Supabase OAuth access token, and asserts: the unauthenticated `401` carries
`resource_metadata` and `scope`; strict RFC 8707 validation rejects the token and
cannot tell the two surfaces apart; grant-table binding accepts it on
`/mcp/workspace`, returns the `get_workspace` payload, and answers `403
insufficient_scope` on `/mcp/admin`; a revoked grant, an expired token, a token
with no `exp` at all, a foreign signing key, a foreign issuer and an unknown
surface are all rejected, and key selection skips JWKS entries that are not
ES256 signing keys even when the token header carries no `kid`.

The client leg — Claude Code or Codex actually connecting — was not run. It needs
a real access token, and minting one needs the consent step, which is blocked for
the reason in the next section rather than by anything about MCP.

## Not verified

**The consent leg, and therefore a real token.** `/oauth/authorize` does not
render a consent page. It answers `302` to `<Site URL>/oauth/consent?
authorization_id=…` — on `guidu`, `http://localhost:3000/oauth/consent` — so the
consent screen is an application page we have not built yet. Approving an
authorization goes through `supabase.auth.oauth.getAuthorizationDetails()` and
`approveAuthorization()`, which need (a) a signed-in user and (b) the project
apikey; `GET /auth/v1/oauth/authorizations/<id>` answers `401 No API key found in
request`. The publishable key is redacted by the Paperclip tool gateway, and I
did not try to obtain it another way. So every claim about token *contents* in
this document rests on Supabase's documented claim set, not on a token I read.

To close it, Marcelo would need to bind the `guidu` publishable key as an agent
secret, or run the flow once by hand and paste the decoded (not raw) claims into
this document. The single question that would answer: does the issued token carry
`aud: "authenticated"` and no `resource` claim, as documented. Everything else in
items 1 to 5 is already proven by live probe.

**Rate limits and MAU accounting** were not measured. Supabase states MCP
authentication counts toward Monthly Active Users with no separate charge.

## Recommendation

**Supabase + complement**, split like this.

Supabase owns: user authentication, the OAuth 2.1 authorization code + PKCE
flow, client registration, token issuance and signing, refresh rotation, and the
user-facing grant list and revocation.

The application owns, and this is not optional:

1. `/.well-known/oauth-protected-resource/mcp/{workspace,admin}` per surface,
   with `authorization_servers` pointing at the `guidu` issuer, plus
   `WWW-Authenticate` on every `401` and `403`.
2. `mcp_grants` as the single authority for which surface and which application
   scopes a `(user, client)` pair holds — because the token carries neither.
   Read it on every request; never cache it for the token lifetime.
3. The consent page at `<Site URL>/oauth/consent`, rendering the `mcp_grants`
   scopes it is about to create rather than the OIDC scopes Supabase passes
   through.
4. The ADR 0001 path, unchanged for MCP. Domain tables stay without
   `anon`/`authenticated` grants, and the MCP server reaches data only through
   Prisma inside `withContext`, deriving `app.grant_id` (and the workspace and
   organization) from the resolved `mcp_grants` row. No RLS policy reads a JWT
   claim; the token is converted into `app.*` context at the edge.

Rejected alternatives. *Supabase pure* fails items 2 and 3 with no path around
them. *A separate OAuth server* would duplicate the identity of users who already
live in Supabase Auth, give up the hosted consent and revocation UI, and buy
audience binding and custom scopes at the price of a second system to operate —
too much for two gaps that the grant table closes within the specification.

Before F4 starts, three decisions belong to Marcelo: whether Dynamic Client
Registration stays enabled in production given that it is unauthenticated; the
Site URL and canonical URIs for the two MCP surfaces; and whether to bind the
publishable key so the consent leg can be proven.
