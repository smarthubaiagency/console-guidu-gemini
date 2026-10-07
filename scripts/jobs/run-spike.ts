import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { PgBoss } from 'pg-boss'
import { requireUrl, RuntimeDatabase } from './db.js'

const A = {
  userId: '10000000-0000-4000-8000-000000000003',
  workspaceId: '10000000-0000-4000-8000-000000000002',
  organizationId: '10000000-0000-4000-8000-000000000001',
}
const B = {
  userId: '20000000-0000-4000-8000-000000000003',
  workspaceId: '20000000-0000-4000-8000-000000000002',
  organizationId: '20000000-0000-4000-8000-000000000001',
}

type Payload = typeof A & { idempotencyKey: string; mode: 'effect' | 'retry' | 'dead' | 'group' }

const results: Record<string, unknown> = {}

function createBoss(db: RuntimeDatabase, instanceName: string): PgBoss {
  const boss = new PgBoss({
    db,
    schema: 'sma94_jobs',
    migrate: false,
    createSchema: false,
    useListenNotify: false,
    superviseIntervalSeconds: 1,
    maintenanceIntervalSeconds: 1,
    instanceName,
  })
  boss.on('error', (error) => console.error('pg-boss', error))
  return boss
}

async function waitUntil(label: string, predicate: () => Promise<boolean>, timeoutMs = 20_000) {
  const started = Date.now()
  while (!(await predicate())) {
    if (Date.now() - started > timeoutMs) throw new Error(`timeout waiting for ${label}`)
    await delay(200)
  }
  return Date.now() - started
}

async function insertEffect(db: RuntimeDatabase, payload: Payload) {
  return db.withContext(payload, async (client) => {
    const identity = await client.query('select session_user, current_user')
    assert.equal(identity.rows[0].current_user, 'app_runtime')
    const inserted = await client.query(
      `insert into public.sma94_job_effects
         (idempotency_key, workspace_id, organization_id)
       values ($1, $2, $3)
       on conflict (idempotency_key) do nothing
       returning id`,
      [payload.idempotencyKey, payload.workspaceId, payload.organizationId],
    )
    return inserted.rowCount ?? 0
  })
}

async function run(connectionName: 'direct' | 'pooler', connectionString: string) {
  const db = new RuntimeDatabase(connectionString)
  const producer = createBoss(db, `${connectionName}-producer`)
  await producer.start()
  assert.equal(await producer.schemaVersion(), 45)

  const suffix = `${connectionName}-${Date.now()}`
  const restartPayload: Payload = { ...A, idempotencyKey: `restart-${suffix}`, mode: 'effect' }
  const restartId = await producer.send('sma94-work', restartPayload, {
    singletonKey: restartPayload.idempotencyKey,
    group: { id: A.workspaceId },
  })
  assert.ok(restartId)
  await producer.stop({ close: false })

  const worker = createBoss(db, `${connectionName}-worker-after-restart`)
  await worker.start()
  let retryAttempts = 0
  let groupActive = 0
  let groupMax = 0

  await worker.work<Payload>('sma94-work', {
    localConcurrency: 4,
    localGroupConcurrency: 1,
    pollingIntervalSeconds: 0.5,
  }, async ([job]) => {
    assert.ok(job, 'pg-boss worker callback requires one job')
    const payload = job.data
    if (payload.mode === 'retry') {
      retryAttempts += 1
      if (retryAttempts === 1) throw new Error('synthetic first-attempt failure')
    }
    if (payload.mode === 'dead') throw new Error('synthetic terminal failure')
    if (payload.mode === 'group') {
      groupActive += 1
      groupMax = Math.max(groupMax, groupActive)
      await delay(250)
      groupActive -= 1
    }
    await insertEffect(db, payload)
  })

  const restartMs = await waitUntil('restart effect', async () => {
    const found = await db.withContext(A, (client) =>
      client.query('select count(*)::int as count from public.sma94_job_effects where idempotency_key = $1', [restartPayload.idempotencyKey]),
    )
    return found.rows[0].count === 1
  })

  const duplicatePayload: Payload = { ...A, idempotencyKey: `duplicate-${suffix}`, mode: 'effect' }
  const firstDuplicate = await worker.send('sma94-work', duplicatePayload, { singletonKey: duplicatePayload.idempotencyKey })
  const secondDuplicate = await worker.send('sma94-work', duplicatePayload, { singletonKey: duplicatePayload.idempotencyKey })
  await waitUntil('idempotent effect', async () => {
    const found = await db.withContext(A, (client) =>
      client.query('select count(*)::int as count from public.sma94_job_effects where idempotency_key = $1', [duplicatePayload.idempotencyKey]),
    )
    return found.rows[0].count === 1
  })

  const retryPayload: Payload = { ...A, idempotencyKey: `retry-${suffix}`, mode: 'retry' }
  const retryId = await worker.send('sma94-work', retryPayload, {
    retryLimit: 2,
    retryDelay: 1,
    retryBackoff: true,
  })
  assert.ok(retryId)
  const retryMs = await waitUntil('retry success', async () => retryAttempts >= 2)

  const deadPayload: Payload = { ...A, idempotencyKey: `dead-${suffix}`, mode: 'dead' }
  const deadId = await worker.send('sma94-work', deadPayload, {
    retryLimit: 1,
    retryDelay: 1,
    deadLetter: 'sma94-dead',
  })
  assert.ok(deadId)
  const deadLetterMs = await waitUntil('dead letter', async () => {
    const jobs = await worker.findJobs('sma94-dead')
    return jobs.some((job) => job.data && (job.data as Payload).idempotencyKey === deadPayload.idempotencyKey)
  })

  const groupIds = await Promise.all(
    Array.from({ length: 4 }, (_, index) => {
      const payload: Payload = { ...A, idempotencyKey: `group-${index}-${suffix}`, mode: 'group' }
      return worker.send('sma94-work', payload, { group: { id: A.workspaceId } })
    }),
  )
  assert.ok(groupIds.every(Boolean))
  await waitUntil('group completion', async () => {
    const found = await db.withContext(A, (client) =>
      client.query("select count(*)::int as count from public.sma94_job_effects where idempotency_key like $1", [`group-%-${suffix}`]),
    )
    return found.rows[0].count === 4
  })
  assert.equal(groupMax, 1)

  let denied = false
  try {
    await insertEffect(db, { ...A, userId: B.userId, idempotencyKey: `denied-${suffix}`, mode: 'effect' })
  } catch (error) {
    denied = (error as Error).message.includes('authorization denied')
  }
  assert.equal(denied, true)

  await worker.schedule('sma94-work', '*/5 * * * *', { ...A, idempotencyKey: `cron-${suffix}`, mode: 'effect' }, { key: `cron-${connectionName}` })
  const schedule = await worker.getSchedule('sma94-work', `cron-${connectionName}`)
  assert.equal(schedule?.cron, '*/5 * * * *')

  const queue = await worker.getQueue('sma94-work')
  const stats = await worker.getQueueStats('sma94-work')
  const attempts = await worker.findJobs('sma94-work', { id: retryId })
  results[connectionName] = {
    schemaVersion: await worker.schemaVersion(),
    currentUser: 'app_runtime',
    restartMs,
    retryAttempts,
    retryMs,
    deadLetterMs,
    duplicateSendIds: [firstDuplicate, secondDuplicate],
    groupMax,
    crossTenantDenied: denied,
    schedule: schedule?.cron,
    queue: queue && {
      retryLimit: queue.retryLimit,
      retryDelay: queue.retryDelay,
      retryBackoff: queue.retryBackoff,
      expireInSeconds: queue.expireInSeconds,
      deadLetter: queue.deadLetter,
    },
    retryJob: attempts[0] && { state: attempts[0].state, retryCount: attempts[0].retryCount },
    statsRows: stats.length,
  }

  await worker.stop({ close: false })
  await db.close()
}

await run('direct', requireUrl('DIRECT_DATABASE_URL'))
await run('pooler', requireUrl('DATABASE_URL'))
console.log(JSON.stringify(results, null, 2))
