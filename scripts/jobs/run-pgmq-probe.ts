import assert from 'node:assert/strict'
import { requireUrl, RuntimeDatabase } from './db.js'

const db = new RuntimeDatabase(requireUrl('DIRECT_DATABASE_URL'))
const suffix = Date.now().toString()
const sent = await db.executeSql(
  "select * from pgmq.send('sma94_probe', jsonb_build_object('key', $1::text))",
  [suffix],
)
assert.equal(sent.rows.length, 1)

const read = await db.executeSql("select * from pgmq.read('sma94_probe', 2, 1)")
assert.equal(read.rows.length, 1)
assert.equal(read.rows[0]!.message.key, suffix)

const hidden = await db.executeSql("select * from pgmq.read('sma94_probe', 2, 1)")
assert.equal(hidden.rows.length, 0)

await new Promise((resolve) => setTimeout(resolve, 2200))
const redelivered = await db.executeSql("select * from pgmq.read('sma94_probe', 2, 1)")
assert.equal(redelivered.rows[0]!.read_ct, 2)
await db.executeSql("select pgmq.archive('sma94_probe', $1::bigint)", [redelivered.rows[0]!.msg_id])

const functions = await db.executeSql(`
  select p.proname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'pgmq'
  order by p.proname
`)

console.log(JSON.stringify({
  visibilityTimeoutRedelivery: true,
  readCount: redelivered.rows[0]!.read_ct,
  archive: true,
  functions: [...new Set(functions.rows.map((row) => row.proname))],
}, null, 2))
await db.close()
