// PROVA DE CONCEITO (IN1, docs/modules/inbox/prova-de-conceito.md).
// Verificações do login JWT e do E2EE do lado do atendente (prova IN1).
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(process.argv[2], "utf8").split("\n").filter(l => l.includes("=")).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const HS = env.MATRIX_HOMESERVER_URL;
const AS = env.MATRIX_AS_TOKEN;
const ATT = process.argv[3]; // localpart da Ana
const ROOM = process.argv[4];
const b64 = v => Buffer.from(JSON.stringify(v)).toString("base64url");
function jwt(claims, secret = env.MATRIX_JWT_SECRET) {
  const h = b64({ alg: "HS256", typ: "JWT" }), p = b64(claims);
  return `${h}.${p}.${createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`;
}
const now = Math.floor(Date.now() / 1000);
const base = { iss: env.MATRIX_JWT_ISSUER, aud: env.MATRIX_JWT_AUDIENCE, iat: now, exp: now + 60 };
async function login(label, token) {
  const r = await fetch(`${HS}/_matrix/client/v3/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "org.matrix.login.jwt", token }) });
  const j = await r.json();
  console.log(`${label}: HTTP ${r.status} ${JSON.stringify(j).replace(/"access_token":"[^"]+"/, '"access_token":"…"').slice(0, 200)}`);
  return j;
}
async function req(token, method, path, body) {
  const r = await fetch(HS + path, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json() };
}
const good = jwt({ ...base, sub: ATT });
const ok = await login("JWT válido (60 s)", good);
await login("mesmo JWT de novo (reuso dentro do prazo)", good);
await login("JWT vencido (exp há 5 min)", jwt({ ...base, sub: ATT, iat: now - 600, exp: now - 300 }));
await login("JWT com audience errada", jwt({ ...base, sub: ATT, aud: "outro" }));
await login("JWT com issuer errado", jwt({ ...base, sub: ATT, iss: "outro" }));
await login("JWT com assinatura errada", jwt({ ...base, sub: ATT }, "segredo-errado"));
const { exp, ...noExp } = base;
await login("JWT sem exp (aceito? então o console precisa sempre pôr exp)", jwt({ ...noExp, sub: ATT }));
const newbie = `u_naoprovisionado${now}`;
await login("JWT de usuário que não existe (o Synapse cria a conta)", jwt({ ...base, sub: newbie }));
await login("JWT de localpart do namespace do AS", jwt({ ...base, sub: "_guidu_agent_loja-poc" }));
// Desativação: o usuário criado acima é desativado pela API admin com o as_token.
const id = `@${newbie}:${env.MATRIX_SERVER_NAME}`;
console.log("desativa pela API admin (as_token):", (await req(AS, "POST", `/_synapse/admin/v1/deactivate/${encodeURIComponent(id)}`, { erase: false })).status);
await login("JWT de usuário desativado", jwt({ ...base, sub: newbie }));
// E2EE pelo atendente (nível 50) na sala da conversa.
if (ROOM && ok.access_token) {
  const r = await req(ok.access_token, "PUT", `/_matrix/client/v3/rooms/${encodeURIComponent(ROOM)}/state/m.room.encryption/`, { algorithm: "m.megolm.v1.aes-sha2" });
  console.log(`atendente tenta ligar E2EE: HTTP ${r.status} ${JSON.stringify(r.json)}`);
  const e = await req(ok.access_token, "GET", `/_matrix/client/v3/rooms/${encodeURIComponent(ROOM)}/state/m.room.encryption/`);
  console.log(`m.room.encryption na sala: HTTP ${e.status} ${JSON.stringify(e.json)}`);
  const pl = await req(ok.access_token, "GET", `/_matrix/client/v3/rooms/${encodeURIComponent(ROOM)}/state/m.room.power_levels/`);
  console.log(`power levels: ${JSON.stringify(pl.json)}`);
  const cr = await req(ok.access_token, "GET", `/_matrix/client/v3/rooms/${encodeURIComponent(ROOM)}/state/m.room.create/`);
  console.log(`m.room.create: ${JSON.stringify(cr.json)}`);
  await req(ok.access_token, "POST", "/_matrix/client/v3/logout");
}
