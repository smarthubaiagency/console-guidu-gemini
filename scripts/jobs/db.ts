import pg from 'pg'
import type { Db as IDatabase } from 'pg-boss'

export const ssl = { rejectUnauthorized: false }

export function requireUrl(name: 'DATABASE_URL' | 'DIRECT_DATABASE_URL'): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

export class RuntimeDatabase implements IDatabase {
  readonly pool: pg.Pool

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, ssl, max: 6 })
  }

  async executeSql(text: string, values?: unknown[]): Promise<{ rows: pg.QueryResultRow[] }> {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      await client.query('set local role app_runtime')
      const result = await client.query(text, values)
      await client.query('commit')
      const rows = Array.isArray(result)
        ? result.flatMap((entry) => entry.rows)
        : result.rows
      return { rows }
    } catch (error) {
      await client.query('rollback').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async withContext<T>(
    context: { userId: string; workspaceId: string; organizationId: string },
    callback: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      await client.query('set local role app_runtime')
      await client.query(
        "select set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true), set_config('app.organization_id', $3, true)",
        [context.userId, context.workspaceId, context.organizationId],
      )
      const authorized = await client.query(
        'select spike_private.is_current_member($1::uuid, $2::uuid) as allowed',
        [context.workspaceId, context.organizationId],
      )
      if (authorized.rows[0]?.allowed !== true) throw new Error('authorization denied at execution time')
      const result = await callback(client)
      await client.query('commit')
      return result
    } catch (error) {
      await client.query('rollback').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
