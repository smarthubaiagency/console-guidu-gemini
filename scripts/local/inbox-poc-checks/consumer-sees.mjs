// PROVA DE CONCEITO (IN1, docs/modules/inbox/prova-de-conceito.md).
// O que mais um consumidor enxerga além do estado da sala: presença, recibos, perfil.
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(process.argv[2], "utf8").split("\n").filter(l => l.includes("=")).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const HS = env.MATRIX_HOMESERVER_URL, AS = env.MATRIX_AS_TOKEN, ROOM = process.argv[3], ANA = process.argv[4];
const call = async (tok, m, p, b) => { const r = await fetch(HS + p, { method: m, headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, json: await r.json() }; };
const { nonce } = (await call("", "GET", "/_synapse/admin/v1/register")).json;
const username = `cliente_olhar_${Date.now().toString(36)}`, password = randomUUID();
const mac = createHmac("sha1", env.MATRIX_REGISTRATION_SHARED_SECRET).update(`${nonce}\0${username}\0${password}\0notadmin`).digest("hex");
const me = (await call("", "POST", "/_synapse/admin/v1/register", { nonce, username, password, admin: false, mac })).json;
await call(AS, "POST", `/_matrix/client/v3/rooms/${encodeURIComponent(ROOM)}/invite`, { user_id: me.user_id });
await call(me.access_token, "POST", `/_matrix/client/v3/rooms/${encodeURIComponent(ROOM)}/join`, {});
const pres = await call(me.access_token, "GET", `/_matrix/client/v3/presence/${encodeURIComponent(ANA)}/status`);
console.log(`presença da atendente vista pelo consumidor: HTTP ${pres.status} ${JSON.stringify(pres.json)}`);
const prof = await call(me.access_token, "GET", `/_matrix/client/v3/profile/${encodeURIComponent(ANA)}`);
console.log(`perfil da atendente: HTTP ${prof.status} ${JSON.stringify(prof.json)}`);
const sync = await call(me.access_token, "GET", "/_matrix/client/v3/sync?timeout=0");
const room = sync.json.rooms?.join?.[ROOM] ?? {};
console.log(`tipos na timeline: ${[...new Set((room.timeline?.events ?? []).map(e => e.type))].join(", ")}`);
console.log(`efêmeros (recibos, digitando): ${JSON.stringify(room.ephemeral?.events ?? []).slice(0, 400)}`);
const dir = await call(me.access_token, "POST", "/_matrix/client/v3/user_directory/search", { search_term: "Ana", limit: 5 });
console.log(`diretório de usuários (busca "Ana"): ${JSON.stringify(dir.json)}`);
const dir2 = await call(me.access_token, "POST", "/_matrix/client/v3/user_directory/search", { search_term: "cliente", limit: 5 });
console.log(`diretório de usuários (busca "cliente"): ${dir2.json.results?.length} resultados`);
