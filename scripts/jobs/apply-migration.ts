import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { requireUrl, ssl } from './db.js'

const version = '20261007230000'
const name = 'sma94_jobs_spike'
const path = `supabase/migrations/${version}_${name}.sql`
const client = new pg.Client({ connectionString: requireUrl('DIRECT_DATABASE_URL'), ssl })
await client.connect()
try {
  const existing = await client.query(
    'select version, name from supabase_migrations.schema_migrations order by version',
  )
  console.log('list_migrations_before', existing.rows)
  if (existing.rows.some((row) => row.version === version)) {
    console.log('already_applied', { version, name })
    process.exitCode = 0
  } else {
    await client.query(await readFile(path, 'utf8'))
    await client.query(
      'insert into supabase_migrations.schema_migrations(version, name, statements) values ($1, $2, $3)',
      [version, name, []],
    )
    console.log('applied', { version, name })
  }
} finally {
  await client.end()
}
