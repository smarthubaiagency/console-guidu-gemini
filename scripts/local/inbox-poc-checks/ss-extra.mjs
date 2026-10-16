// PROVA DE CONCEITO (IN1, docs/modules/inbox/prova-de-conceito.md).
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(process.argv[2], "utf8").split("\n").filter(l => l.includes("=")).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const HS = env.MATRIX_HOMESERVER_URL;
const b64 = v => Buffer.from(JSON.stringify(v)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const h = b64({ alg: "HS256", typ: "JWT" }), p = b64({ sub: process.argv[3], iss: env.MATRIX_JWT_ISSUER, aud: env.MATRIX_JWT_AUDIENCE, iat: now, exp: now + 60 });
const jwt = `${h}.${p}.${createHmac("sha256", env.MATRIX_JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`;
const { access_token } = await (await fetch(`${HS}/_matrix/client/v3/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "org.matrix.login.jwt", token: jwt }) })).json();
async function ss(label, body, pos) {
  const t = performance.now();
  const r = await fetch(`${HS}/_matrix/client/unstable/org.matrix.simplified_msc3575/sync?timeout=0${pos ? `&pos=${pos}` : ""}`, { method: "POST", headers: { authorization: `Bearer ${access_token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await r.text(); const j = JSON.parse(text);
  console.log(`${label}: HTTP ${r.status}, ${Math.round(performance.now() - t)} ms, ${Math.round(text.length / 1024)} KiB, ${Object.keys(j.rooms ?? {}).length} salas`);
  return j;
}
const list = (ranges) => ({ lists: { conversas: { ranges, timeline_limit: 1, required_state: [["m.room.name", ""], ["chat.guidu.conversation", ""]] } } });
const first = await ss("sliding, 20 primeiras", list([[0, 19]]));
await ss("sliding, rolagem para 20-39 (mesma conexão)", list([[0, 39]]), first.pos);
await ss("sliding, lista inteira (0-304) numa resposta", list([[0, 304]]));
const filt = await ss("sliding, filtro por nome 'Carga 01'", { lists: { conversas: { ranges: [[0, 19]], timeline_limit: 1, required_state: [], filters: { room_name_like: "Carga 01" } } } });
console.log("  count com filtro:", filt.lists?.conversas?.count);
await fetch(`${HS}/_matrix/client/v3/logout`, { method: "POST", headers: { authorization: `Bearer ${access_token}` } });
