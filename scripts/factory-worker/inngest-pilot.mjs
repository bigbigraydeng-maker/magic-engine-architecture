#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Inngest } from 'inngest'
import { connect } from 'inngest/connect'

export const PILOT_SCHEMA_VERSION = 1
export const PILOT_START_EVENT = 'me/factory.pilot.requested'
export const PILOT_REVIEW_EVENT = 'me/factory.pilot.reviewed'
export const MAX_PILOT_EVENT_SENDS = 3

const DEFAULT_PILOT_VERSION = 'cts-dry-run-v1'
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const SEND_LIMITS = Object.freeze({ start: 1, duplicate: 1, review: 1 })
const PILOT_ENV_KEYS = Object.freeze([
  'INNGEST_EVENT_KEY',
  'INNGEST_SIGNING_KEY',
  'INNGEST_DEV',
  'INNGEST_PILOT_CLIENT_ID',
  'INNGEST_PILOT_VERSION',
  'INNGEST_PILOT_CRASH_AFTER_EFFECT',
])
const ENDPOINT_OVERRIDE_KEYS = Object.freeze([
  'INNGEST_BASE_URL',
  'INNGEST_EVENT_API_BASE_URL',
  'INNGEST_API_BASE_URL',
  'INNGEST_DEVSERVER_URL',
])

export function loadPilotEnv(envPath = join(import.meta.dirname, '.env')) {
  const fromFile = {}
  const fileEndpointOverrides = []
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!match) continue
      const key = match[1]
      const value = match[2].replace(/^["']|["']$/g, '')
      if (PILOT_ENV_KEYS.includes(key)) fromFile[key] = value
      if (ENDPOINT_OVERRIDE_KEYS.includes(key) && value.trim() !== '') fileEndpointOverrides.push(key)
    }
  }
  const env = {}
  for (const key of PILOT_ENV_KEYS) {
    const value = process.env[key] ?? fromFile[key]
    if (value !== undefined) env[key] = value
  }
  env.__forbiddenEndpointOverrides = [...new Set([
    ...fileEndpointOverrides,
    ...ENDPOINT_OVERRIDE_KEYS.filter((key) => String(process.env[key] ?? '').trim() !== ''),
  ])]
  return env
}

export function requirePilotEnv(env) {
  const required = ['INNGEST_EVENT_KEY', 'INNGEST_SIGNING_KEY', 'INNGEST_PILOT_CLIENT_ID']
  const missing = required.filter((key) => typeof env[key] !== 'string' || env[key].trim() === '')
  if (missing.length > 0) throw new Error(`Missing pilot environment: ${missing.join(', ')}`)
  if (String(env.INNGEST_DEV ?? '0') !== '0') {
    throw new Error('Cloud pilot requires INNGEST_DEV=0')
  }
  if (env.__forbiddenEndpointOverrides?.length > 0) {
    throw new Error(`Cloud pilot rejects endpoint override: ${env.__forbiddenEndpointOverrides.join(', ')}`)
  }
  return {
    clientId: assertSafeId(env.INNGEST_PILOT_CLIENT_ID, 'INNGEST_PILOT_CLIENT_ID'),
    pilotVersion: assertSafeId(env.INNGEST_PILOT_VERSION || DEFAULT_PILOT_VERSION, 'INNGEST_PILOT_VERSION'),
  }
}

export function resolvePilotStateDir(userHome = homedir()) {
  return join(userHome, 'Library', 'Application Support', 'Magic Engine', 'inngest-pilot')
}

export function createStartData({ clientId, pilotVersion, pilotRunId, workOrderId, correlationId }) {
  return {
    schema_version: PILOT_SCHEMA_VERSION,
    pilot_version: assertSafeId(pilotVersion, 'pilot_version'),
    pilot_run_id: assertSafeId(pilotRunId, 'pilot_run_id'),
    work_order_id: assertSafeId(workOrderId, 'work_order_id'),
    client_id: assertSafeId(clientId, 'client_id'),
    correlation_id: assertSafeId(correlationId, 'correlation_id'),
    dry_run: true,
  }
}

export function validateStartData(data, expectedClientId, expectedPilotVersion) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid pilot start payload')
  const parsed = createStartData({
    clientId: data.client_id,
    pilotVersion: data.pilot_version,
    pilotRunId: data.pilot_run_id,
    workOrderId: data.work_order_id,
    correlationId: data.correlation_id,
  })
  if (data.schema_version !== PILOT_SCHEMA_VERSION || data.dry_run !== true) {
    throw new Error('Pilot start must be schema v1 dry_run=true')
  }
  if (parsed.client_id !== expectedClientId) throw new Error('Pilot client scope mismatch')
  if (parsed.pilot_version !== expectedPilotVersion) throw new Error('Pilot version mismatch')
  return parsed
}

export function validateReviewData(data, start) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid pilot review payload')
  const verdict = data.verdict
  if (verdict !== 'pass' && verdict !== 'fail') throw new Error('Pilot verdict must be pass or fail')
  const fields = ['pilot_run_id', 'work_order_id', 'client_id', 'correlation_id', 'pilot_version']
  for (const field of fields) {
    if (assertSafeId(data[field], field) !== start[field]) throw new Error(`Pilot review ${field} mismatch`)
  }
  if (data.schema_version !== PILOT_SCHEMA_VERSION || data.dry_run !== true) {
    throw new Error('Pilot review must be schema v1 dry_run=true')
  }
  return { ...start, verdict }
}

export function validateAdmittedStart(receiptDir, start) {
  const admitted = readJsonIfPresent(join(receiptDir, 'latest-run.json'))
  if (!admitted) throw new Error('No admitted pilot run found')
  assertReceiptFields(start, admitted)
  assertReceiptFields(admitted, start)
  return start
}

export function persistDryRunEffect(receiptDir, start, now = new Date()) {
  const expected = {
    ...start,
    status: 'waiting_review',
    provider_calls: 0,
    production_writes: 0,
    effect_count: 1,
  }
  const path = join(receiptDir, `${start.pilot_run_id}.effect.json`)
  const result = atomicCreateJson(path, { ...expected, created_at: now.toISOString() })
  assertReceiptFields(result.value, expected)
  return { created: result.created, receipt: result.value, path }
}

export function persistReviewReceipt(receiptDir, review, now = new Date()) {
  const expected = {
    ...review,
    status: 'dry_run_complete',
    provider_calls: 0,
    production_writes: 0,
    effect_count: 1,
  }
  const path = join(receiptDir, `${review.pilot_run_id}.review.json`)
  const result = atomicCreateJson(path, { ...expected, reviewed_at: now.toISOString() })
  assertReceiptFields(result.value, expected)
  return { created: result.created, receipt: result.value, path }
}

export function assertSendAllowed(ledger, kind) {
  if (!(kind in SEND_LIMITS)) throw new Error(`Unknown pilot event kind: ${kind}`)
  const attempts = Array.isArray(ledger?.attempts) ? ledger.attempts : []
  if (attempts.length >= MAX_PILOT_EVENT_SENDS) throw new Error('Pilot event budget exhausted')
  const count = attempts.filter((entry) => entry.kind === kind).length
  if (count >= SEND_LIMITS[kind]) throw new Error(`Pilot ${kind} send limit exhausted`)
  return attempts
}

export function eventFingerprint(event) {
  if (!event || typeof event !== 'object' || typeof event.id !== 'string' || typeof event.name !== 'string') {
    throw new Error('Invalid pilot event for outbox')
  }
  return createHash('sha256').update(canonicalJson({ name: event.name, data: event.data })).digest('hex')
}

export function recordSendAttempt(receiptDir, kind, event, now = new Date()) {
  mkdirSync(receiptDir, { recursive: true, mode: 0o700 })
  const path = join(receiptDir, 'event-sends.json')
  const ledger = readJsonIfPresent(path) ?? { schema_version: PILOT_SCHEMA_VERSION, attempts: [] }
  const fingerprint = eventFingerprint(event)
  const existing = ledger.attempts.find((entry) => entry.kind === kind)
  if (existing) {
    if (existing.event_id !== event.id) throw new Error(`Pilot ${kind} event identity conflict`)
    if (existing.event_fingerprint !== fingerprint) throw new Error(`Pilot ${kind} event payload conflict`)
    if (existing.status === 'acknowledged') throw new Error(`Pilot ${kind} send limit exhausted`)
    return ledger
  }
  const attempts = assertSendAllowed(ledger, kind)
  const next = {
    ...ledger,
    attempts: [...attempts, {
      kind,
      event_id: event.id,
      event_fingerprint: fingerprint,
      status: 'prepared',
      prepared_at: now.toISOString(),
    }],
  }
  atomicReplaceJson(path, next)
  return next
}

export function acknowledgeSend(receiptDir, kind, event, now = new Date()) {
  const path = join(receiptDir, 'event-sends.json')
  const ledger = readJsonIfPresent(path)
  const attempts = Array.isArray(ledger?.attempts) ? ledger.attempts : []
  const entry = attempts.find((candidate) => candidate.kind === kind)
  if (!entry || entry.event_id !== event.id || entry.event_fingerprint !== eventFingerprint(event)) {
    throw new Error(`Pilot ${kind} send was not prepared`)
  }
  const next = {
    ...ledger,
    attempts: attempts.map((candidate) => candidate === entry
      ? { ...candidate, status: 'acknowledged', acknowledged_at: now.toISOString() }
      : candidate),
  }
  atomicReplaceJson(path, next)
  return next
}

export function createPilotFunction(client, scope, receiptDir) {
  return client.createFunction(
    {
      id: 'factory-durable-dry-run-pilot',
      name: 'Factory durable dry-run pilot',
      retries: 2,
      idempotency: 'event.data.pilot_run_id',
      concurrency: { limit: 1, key: 'event.data.client_id' },
    },
    { event: PILOT_START_EVENT },
    async ({ event, step }) => {
      const start = await step.run('validate-admitted-client-scoped-dry-run', () => {
        const validated = validateStartData(event.data, scope.clientId, scope.pilotVersion)
        return validateAdmittedStart(receiptDir, validated)
      })
      const effect = await step.run('persist-atomic-dry-run-effect', () => {
        const saved = persistDryRunEffect(receiptDir, start)
        if (scope.crashAfterEffect === '1') process.kill(process.pid, 'SIGKILL')
        return saved.receipt
      })
      const reviewed = await step.waitForEvent('wait-for-scoped-review', {
        event: PILOT_REVIEW_EVENT,
        timeout: '24h',
        if: reviewMatchExpression(),
      })
      if (!reviewed) return { status: 'timed_out', pilot_run_id: start.pilot_run_id, effect_count: effect.effect_count }
      const review = await step.run('validate-scoped-review', () => validateReviewData(reviewed.data, start))
      return await step.run('persist-first-review-decision', () =>
        persistReviewReceipt(receiptDir, review).receipt)
    },
  )
}

export function reviewMatchExpression() {
  const fields = ['correlation_id', 'pilot_run_id', 'work_order_id', 'client_id', 'pilot_version']
  const identity = fields.map((field) => `event.data.${field} == async.data.${field}`).join(' && ')
  return `${identity} && async.data.schema_version == 1 && async.data.dry_run == true && (async.data.verdict == "pass" || async.data.verdict == "fail")`
}

export function acquireWorkerLock(receiptDir) {
  mkdirSync(receiptDir, { recursive: true, mode: 0o700 })
  const path = join(receiptDir, 'connect-worker.lock')
  try {
    return createWorkerLock(path)
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    const pid = Number(readFileSync(path, 'utf8').trim())
    if (Number.isInteger(pid) && isProcessAlive(pid)) throw new Error(`Pilot Connect worker already active (pid ${pid})`)
    rmSync(path, { force: true })
    return createWorkerLock(path)
  }
}

export function acquireSendLock(receiptDir) {
  return acquireNamedProcessLock(receiptDir, 'send-command.lock', 'Pilot send command already active')
}

async function main() {
  const env = loadPilotEnv()
  const configuredScope = requirePilotEnv(env)
  const scope = { ...configuredScope, crashAfterEffect: env.INNGEST_PILOT_CRASH_AFTER_EFFECT }
  hydrateInngestProcessEnv(env)
  const receiptDir = resolvePilotStateDir()
  const client = new Inngest({ id: 'magic-engine-factory-worker-pilot', appVersion: scope.pilotVersion })
  const mode = process.argv[2]
  if (mode === 'connect') return await connectWorker(client, receiptDir, scope)
  if (mode === 'start') return await sendStart(client, receiptDir, scope)
  if (mode === 'duplicate') return await sendDuplicate(client, receiptDir)
  if (mode === 'review') return await sendReview(client, receiptDir, process.argv[3])
  throw new Error('Usage: inngest-pilot.mjs <connect|start|duplicate|review pass|review fail>')
}

async function connectWorker(client, receiptDir, scope) {
  const release = acquireWorkerLock(receiptDir)
  const fn = createPilotFunction(client, scope, receiptDir)
  try {
    const connection = await connect({
      apps: [{ client, functions: [fn] }],
      instanceId: `factory-pilot-${hostname()}`,
      maxWorkerConcurrency: 1,
    })
    console.log(JSON.stringify({ status: connection.state, client_scope: scope.clientId, concurrency: 1 }))
    await connection.closed
  } finally {
    release()
  }
}

async function sendStart(client, receiptDir, scope) {
  await withSendLock(receiptDir, async () => {
    const path = join(receiptDir, 'latest-run.json')
    const existing = readJsonIfPresent(path)
    const data = existing ?? createStartData({
      clientId: scope.clientId,
      pilotVersion: scope.pilotVersion,
      pilotRunId: `pilot-${randomUUID()}`,
      workOrderId: `dryrun-${randomUUID()}`,
      correlationId: `corr-${randomUUID()}`,
    })
    validateStartData(data, scope.clientId, scope.pilotVersion)
    if (!existing) atomicCreateJson(path, data)
    const event = { id: `factory-pilot:start:${data.pilot_run_id}`, name: PILOT_START_EVENT, data }
    await sendPreparedEvent(client, receiptDir, 'start', event)
    console.log(JSON.stringify({ status: 'start_sent', ...data }))
  })
}

async function sendDuplicate(client, receiptDir) {
  await withSendLock(receiptDir, async () => {
    const data = requireLatestRun(receiptDir)
    const event = { id: `factory-pilot:start:${data.pilot_run_id}`, name: PILOT_START_EVENT, data }
    await sendPreparedEvent(client, receiptDir, 'duplicate', event)
    console.log(JSON.stringify({ status: 'duplicate_probe_sent', pilot_run_id: data.pilot_run_id }))
  })
}

async function sendReview(client, receiptDir, verdict) {
  await withSendLock(receiptDir, async () => {
    const start = requireLatestRun(receiptDir)
    const review = validateReviewData({ ...start, verdict }, start)
    const event = { id: `factory-pilot:review:${start.correlation_id}`, name: PILOT_REVIEW_EVENT, data: review }
    await sendPreparedEvent(client, receiptDir, 'review', event)
    console.log(JSON.stringify({ status: 'review_sent', pilot_run_id: start.pilot_run_id, verdict }))
  })
}

async function sendPreparedEvent(client, receiptDir, kind, event) {
  recordSendAttempt(receiptDir, kind, event)
  await client.send(event)
  acknowledgeSend(receiptDir, kind, event)
}

async function withSendLock(receiptDir, fn) {
  const release = acquireSendLock(receiptDir)
  try {
    return await fn()
  } finally {
    release()
  }
}

function requireLatestRun(receiptDir) {
  const data = readJsonIfPresent(join(receiptDir, 'latest-run.json'))
  if (!data) throw new Error('No pilot start metadata found')
  return data
}

function atomicCreateJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  let fd
  try {
    fd = openSync(path, 'wx', 0o600)
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`)
    fsyncSync(fd)
    closeSync(fd)
    return { created: true, value }
  } catch (error) {
    if (fd !== undefined) closeQuietly(fd)
    if (error?.code !== 'EEXIST') throw error
    const existing = readJsonStrict(path)
    return { created: false, value: existing }
  }
}

function atomicReplaceJson(path, value) {
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  renameSync(temp, path)
}

function assertReceiptFields(actual, expected) {
  for (const [key, value] of Object.entries(expected)) {
    if (actual?.[key] !== value) throw new Error(`Existing pilot receipt conflicts at ${key}`)
  }
}

function assertSafeId(value, field) {
  if (typeof value !== 'string' || !SAFE_ID_RE.test(value)) throw new Error(`Invalid ${field}`)
  return value
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function readJsonIfPresent(path) {
  return existsSync(path) ? readJsonStrict(path) : null
}

function readJsonStrict(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new Error(`Corrupt pilot state: ${path}`)
  }
}

function createWorkerLock(path) {
  const fd = openSync(path, 'wx', 0o600)
  writeFileSync(fd, `${process.pid}\n`)
  closeSync(fd)
  return () => rmSync(path, { force: true })
}

function acquireNamedProcessLock(receiptDir, filename, activeMessage) {
  mkdirSync(receiptDir, { recursive: true, mode: 0o700 })
  const path = join(receiptDir, filename)
  try {
    return createWorkerLock(path)
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    const pid = Number(readFileSync(path, 'utf8').trim())
    if (Number.isInteger(pid) && isProcessAlive(pid)) throw new Error(`${activeMessage} (pid ${pid})`)
    rmSync(path, { force: true })
    return createWorkerLock(path)
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function hydrateInngestProcessEnv(env) {
  for (const key of ENDPOINT_OVERRIDE_KEYS) delete process.env[key]
  for (const key of ['INNGEST_EVENT_KEY', 'INNGEST_SIGNING_KEY', 'INNGEST_DEV']) {
    process.env[key] = env[key]
  }
}

export function redactPilotError(error, env = {}) {
  let message = error instanceof Error ? error.message : String(error)
  for (const secret of [env.INNGEST_EVENT_KEY, env.INNGEST_SIGNING_KEY]) {
    if (typeof secret === 'string' && secret.length > 0) message = message.split(secret).join('[REDACTED]')
  }
  return message
    .replace(/inngest-signkey-[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/inngest-[A-Za-z0-9_-]{20,}/g, '[REDACTED]')
}

function closeQuietly(fd) {
  try {
    closeSync(fd)
  } catch {
    // The primary write error is more useful than a secondary close error.
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`INNGEST_PILOT_ERROR: ${redactPilotError(error, loadPilotEnv())}`)
    process.exitCode = 1
  })
}
