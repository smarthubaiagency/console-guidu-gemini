// PROVA DE CONCEITO (IN1, docs/modules/inbox/prova-de-conceito.md).
// Filtro por tipo de sala (room_types) como separação por workspace.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(process.argv[2], "utf8").split("\n").filter(l => l.includes("=")).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const HS = env.MATRIX_HOMESERVER_URL, AS = env.MATRIX_AS_TOKEN, ME = `@${process.argv[3]}:${env.MATRIX_SERVER_NAME}`;
const call = async (tok, m, p, b) => { const r = await fetch(HS + p, { method: m, headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, json: await r.json() }; };
for (const ws of ["ws-a", "ws-a", "ws-b"]) {
  const { json } = await call(AS, "POST", "/_matrix/client/v3/createRoom", { preset: "private_chat", name: `Tipo ${ws}`, creation_content: { type: `chat.guidu.conversation.${ws}` }, power_level_content_override: { users: { [ME]: 50 } } });
  await call(AS, "POST", `/_synapse/admin/v1/join/${encodeURIComponent(json.room_id)}`, { user_id: ME });
}
const b64 = v => Buffer.from(JSON.stringify(v)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const h = b64({ alg: "HS256", typ: "JWT" }), p = b64({ sub: process.argv[3], iss: env.MATRIX_JWT_ISSUER, aud: env.MATRIX_JWT_AUDIENCE, iat: now, exp: now + 60 });
const jwt = `${h}.${p}.${createHmac("sha256", env.MATRIX_JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`;
const { access_token } = (await call("", "POST", "/_matrix/client/v3/login", { type: "org.matrix.login.jwt", token: jwt })).json;
for (const type of ["chat.guidu.conversation.ws-a", "chat.guidu.conversation.ws-b"]) {
  const r = await call(access_token, "POST", "/_matrix/client/unstable/org.matrix.simplified_msc3575/sync?timeout=0", { lists: { l: { ranges: [[0, 9]], timeline_limit: 0, required_state: [["m.room.name", ""]], filters: { room_types: [type] } } } });
  console.log(`room_types=[${type}]: HTTP ${r.status}, count ${r.json.lists?.l?.count}, salas: ${Object.values(r.json.rooms ?? {}).map(x => x.name).join(", ")}`);
}
const t = await call(access_token, "POST", "/_matrix/client/unstable/org.matrix.simplified_msc3575/sync?timeout=0", { lists: { l: { ranges: [[0, 9]], timeline_limit: 0, required_state: [], filters: { spaces: ["!x:dev.guidu.chat"] } } } });
console.log(`filtro spaces: HTTP ${t.status} ${JSON.stringify(t.json)}`);
await call(access_token, "POST", "/_matrix/client/v3/logout");
