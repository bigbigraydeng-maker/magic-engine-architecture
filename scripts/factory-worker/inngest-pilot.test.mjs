import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  MAX_PILOT_EVENT_SENDS,
  acknowledgeSend,
  acquireSendLock,
  acquireWorkerLock,
  assertSendAllowed,
  createStartData,
  loadPilotEnv,
  persistDryRunEffect,
  persistReviewReceipt,
  redactPilotError,
  recordSendAttempt,
  requirePilotEnv,
  resolvePilotStateDir,
  reviewMatchExpression,
  validateAdmittedStart,
  validateReviewData,
  validateStartData,
} from './inngest-pilot.mjs'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const VERSION = 'cts-dry-run-v1'

function startData(overrides = {}) {
  return createStartData({
    clientId: CLIENT,
    pilotVersion: VERSION,
    pilotRunId: 'pilot-run-1',
    workOrderId: 'dryrun-work-order-1',
    correlationId: 'correlation-1',
    ...overrides,
  })
}

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'me-inngest-pilot-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('start payload is client-scoped and dry-run only', () => {
  const data = startData()
  assert.deepEqual(validateStartData(data, CLIENT, VERSION), data)
  assert.throws(() => validateStartData(data, 'other-client', VERSION), /scope mismatch/)
  assert.throws(() => validateStartData({ ...data, dry_run: false }, CLIENT, VERSION), /dry_run=true/)
})

test('malformed identifiers fail before any receipt is written', () => {
  assert.throws(() => startData({ correlationId: '../../escape' }), /Invalid correlation_id/)
  assert.throws(() => startData({ pilotRunId: '' }), /Invalid pilot_run_id/)
})

test('review must match every identity field and a valid verdict', () => {
  const start = startData()
  assert.equal(validateReviewData({ ...start, verdict: 'pass' }, start).verdict, 'pass')
  assert.throws(() => validateReviewData({ ...start, verdict: 'approve' }, start), /pass or fail/)
  assert.throws(() => validateReviewData({ ...start, client_id: 'other-client', verdict: 'fail' }, start), /client_id mismatch/)
  assert.throws(() => validateReviewData({ ...start, correlation_id: 'other-correlation', verdict: 'fail' }, start), /correlation_id mismatch/)
})

test('review wait expression scopes all identity fields', () => {
  const expression = reviewMatchExpression()
  for (const field of ['correlation_id', 'pilot_run_id', 'work_order_id', 'client_id', 'pilot_version']) {
    assert.match(expression, new RegExp(`event\\.data\\.${field} == async\\.data\\.${field}`))
  }
  assert.match(expression, /async\.data\.schema_version == 1/)
  assert.match(expression, /async\.data\.dry_run == true/)
  assert.match(expression, /async\.data\.verdict == "pass"/)
  assert.match(expression, /async\.data\.verdict == "fail"/)
})

test('consumer accepts only the single locally admitted run', () => withDir((dir) => {
  const admitted = startData()
  writeFileSync(join(dir, 'latest-run.json'), JSON.stringify(admitted))
  assert.deepEqual(validateAdmittedStart(dir, admitted), admitted)
  assert.throws(() => validateAdmittedStart(dir, { ...admitted, pilot_run_id: 'pilot-run-2' }), /conflicts/)
}))

test('atomic effect is created once across duplicate and 25-hour-later replay', () => withDir((dir) => {
  const start = startData()
  const first = persistDryRunEffect(dir, start, new Date('2026-08-30T00:00:00Z'))
  const duplicate = persistDryRunEffect(dir, start, new Date('2026-08-31T01:00:00Z'))
  assert.equal(first.created, true)
  assert.equal(duplicate.created, false)
  assert.equal(duplicate.receipt.effect_count, 1)
  assert.equal(duplicate.receipt.created_at, '2026-08-30T00:00:00.000Z')
  assert.equal(duplicate.receipt.provider_calls, 0)
  assert.equal(duplicate.receipt.production_writes, 0)
}))

test('corrupt or conflicting existing effect fails closed', () => withDir((dir) => {
  const start = startData()
  writeFileSync(join(dir, `${start.pilot_run_id}.effect.json`), '{broken')
  assert.throws(() => persistDryRunEffect(dir, start), /Corrupt pilot state/)
}))

test('first review decision wins and conflicting decision is rejected', () => withDir((dir) => {
  const start = startData()
  const pass = { ...start, verdict: 'pass' }
  assert.equal(persistReviewReceipt(dir, pass).created, true)
  assert.equal(persistReviewReceipt(dir, pass).created, false)
  assert.throws(() => persistReviewReceipt(dir, { ...start, verdict: 'fail' }), /conflicts at verdict/)
}))

test('send outbox retries one stable event and caps acknowledged kinds', () => withDir((dir) => {
  const startEvent = { id: 'start-event', name: 'me/factory.pilot.requested', data: startData() }
  let ledger = recordSendAttempt(dir, 'start', startEvent)
  assert.equal(ledger.attempts[0].status, 'prepared')
  ledger = recordSendAttempt(dir, 'start', startEvent)
  assert.equal(ledger.attempts.length, 1)
  assert.throws(() => recordSendAttempt(dir, 'start', { ...startEvent, id: 'different-start-event' }), /identity conflict/)
  ledger = acknowledgeSend(dir, 'start', startEvent)
  assert.equal(ledger.attempts[0].status, 'acknowledged')
  assert.throws(() => recordSendAttempt(dir, 'start', startEvent), /limit exhausted/)
  ledger = recordSendAttempt(dir, 'duplicate', startEvent)
  ledger = acknowledgeSend(dir, 'duplicate', startEvent)
  const reviewEvent = { id: 'review-event', name: 'me/factory.pilot.reviewed', data: { ...startData(), verdict: 'pass' } }
  ledger = recordSendAttempt(dir, 'review', reviewEvent)
  ledger = acknowledgeSend(dir, 'review', reviewEvent)
  assert.equal(ledger.attempts.length, MAX_PILOT_EVENT_SENDS)
  assert.throws(() => assertSendAllowed(ledger, 'review'), /exhausted/)
  assert.throws(() => assertSendAllowed(ledger, 'start'), /exhausted/)
}))

test('prepared review retry requires the identical verdict payload', () => withDir((dir) => {
  const pass = { id: 'review-event', name: 'me/factory.pilot.reviewed', data: { ...startData(), verdict: 'pass' } }
  const fail = { ...pass, data: { ...pass.data, verdict: 'fail' } }
  const prepared = recordSendAttempt(dir, 'review', pass)
  assert.equal(prepared.attempts[0].status, 'prepared')
  assert.equal(recordSendAttempt(dir, 'review', pass).attempts.length, 1)
  assert.throws(() => recordSendAttempt(dir, 'review', fail), /payload conflict/)
}))

test('local worker lock rejects a second active process', () => withDir((dir) => {
  const release = acquireWorkerLock(dir)
  try {
    assert.throws(() => acquireWorkerLock(dir), /already active/)
  } finally {
    release()
  }
}))

test('machine state and locks are independent of worktree path', () => withDir((home) => {
  const fromWorktreeA = resolvePilotStateDir(home)
  const fromWorktreeB = resolvePilotStateDir(home)
  assert.equal(fromWorktreeA, fromWorktreeB)
  const release = acquireSendLock(fromWorktreeA)
  try {
    assert.throws(() => acquireSendLock(fromWorktreeB), /already active/)
  } finally {
    release()
  }
}))

test('pilot env is allowlisted, rejects endpoint overrides, and redacts secrets', () => withDir((dir) => {
  const path = join(dir, '.env')
  const eventKey = 'event-secret-sentinel-value'
  const signingKey = 'signing-secret-sentinel-value'
  writeFileSync(path, [
    `INNGEST_EVENT_KEY=${eventKey}`,
    `INNGEST_SIGNING_KEY=${signingKey}`,
    `INNGEST_PILOT_CLIENT_ID=${CLIENT}`,
    'INNGEST_DEV=0',
    'OPENAI_API_KEY=provider-secret-must-not-be-retained',
    'INNGEST_BASE_URL=https://untrusted.invalid',
  ].join('\n'))
  const env = loadPilotEnv(path)
  assert.equal('OPENAI_API_KEY' in env, false)
  assert.equal('INNGEST_BASE_URL' in env, false)
  assert.deepEqual(env.__forbiddenEndpointOverrides, ['INNGEST_BASE_URL'])
  assert.throws(() => requirePilotEnv(env), /rejects endpoint override/)
  const redacted = redactPilotError(new Error(`failed ${eventKey} ${signingKey}`), env)
  assert.equal(redacted.includes(eventKey), false)
  assert.equal(redacted.includes(signingKey), false)
  assert.match(redacted, /\[REDACTED\]/)
}))

test('pilot source has no production, provider, database, or child-process dependency', () => {
  const source = readFileSync(join(import.meta.dirname, 'inngest-pilot.mjs'), 'utf8').toLowerCase()
  for (const forbidden of ['worker.mjs', '@supabase', 'child_process', 'muapi', 'openai', '/api/', 'content_work_orders']) {
    assert.equal(source.includes(forbidden), false, `forbidden token present: ${forbidden}`)
  }
})
