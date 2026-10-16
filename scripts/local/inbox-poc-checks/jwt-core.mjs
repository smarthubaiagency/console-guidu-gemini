// PROVA DE CONCEITO (IN1, docs/modules/inbox/prova-de-conceito.md).
// O segredo do JWT entra como o usuário do núcleo (admin)?
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(process.argv[2], "utf8").split("\n").filter(l => l.includes("=")).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const b64 = v => Buffer.from(JSON.stringify(v)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const h = b64({ alg: "HS256", typ: "JWT" }), p = b64({ sub: env.MATRIX_AS_SENDER, iss: env.MATRIX_JWT_ISSUER, aud: env.MATRIX_JWT_AUDIENCE, iat: now, exp: now + 60 });
const token = `${h}.${p}.${createHmac("sha256", env.MATRIX_JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`;
const r = await fetch(`${env.MATRIX_HOMESERVER_URL}/_matrix/client/v3/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "org.matrix.login.jwt", token }) });
const j = await r.json();
console.log(`login JWT como ${env.MATRIX_AS_SENDER}: HTTP ${r.status} ${j.user_id ?? JSON.stringify(j)}`);
if (j.access_token) {
  const a = await fetch(`${env.MATRIX_HOMESERVER_URL}/_synapse/admin/v2/users?limit=1`, { headers: { authorization: `Bearer ${j.access_token}` } });
  console.log(`API admin com esse token: HTTP ${a.status}`);
  await fetch(`${env.MATRIX_HOMESERVER_URL}/_matrix/client/v3/logout`, { method: "POST", headers: { authorization: `Bearer ${j.access_token}` } });
}
