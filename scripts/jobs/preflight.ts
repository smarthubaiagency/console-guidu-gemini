import pg from 'pg'
import { requireUrl, ssl } from './db.js'

for (const [label, connectionString] of [
  ['pooler', requireUrl('DATABASE_URL')],
  ['direct', requireUrl('DIRECT_DATABASE_URL')],
] as const) {
  const client = new pg.Client({ connectionString, ssl })
  await client.connect()
  const result = await client.query(`
    select current_database() as database,
           current_user,
           current_setting('is_superuser') as superuser,
           current_setting('row_security') as row_security
  `)
  console.log(label, result.rows[0])
  await client.end()
}

const client = new pg.Client({ connectionString: requireUrl('DIRECT_DATABASE_URL'), ssl })
await client.connect()
const migrations = await client.query(`
  select version, name
  from supabase_migrations.schema_migrations
  order by version
`)
const extensions = await client.query(`
  select name, default_version, installed_version
  from pg_available_extensions
  where name in ('pgmq', 'pg_cron')
  order by name
`)
const roles = await client.query(`
  select rolname, rolcanlogin, rolsuper, rolbypassrls
  from pg_roles
  where rolname in ('app_runtime', 'app_migrations')
  order by rolname
`)
console.log('list_migrations', migrations.rows)
console.log('extensions', extensions.rows)
console.log('roles', roles.rows)
await client.end()
