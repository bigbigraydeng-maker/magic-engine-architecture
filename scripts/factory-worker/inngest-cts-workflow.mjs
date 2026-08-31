#!/usr/bin/env node

import { randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir, hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { Inngest } from 'inngest'
import { connect } from 'inngest/connect'

import { resolveRecipe, computeRecipeFinalDuration } from './creative-recipe.mjs'

export const CTS_WORKFLOW_SCHEMA_VERSION = 1
export const CTS_REQUEST_EVENT = 'me/factory.cts-candidate.requested'
export const CTS_REVIEW_EVENT = 'me/factory.cts-candidate.reviewed'
export const CTS_WORKFLOW_VERSION = 'cts-one-candidate-v1'

const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const WORKFLOW_ENV_KEYS = Object.freeze([
  'INNGEST_EVENT_KEY',
  'INNGEST_SIGNING_KEY',
  'INNGEST_DEV',
  'CTS_INNGEST_CLIENT_ID',
  'CTS_INNGEST_RECIPE_ID',
  'CTS_INNGEST_MAX_PROVIDER_USD',
  'FACTORY_WORKER_TOKEN',
  'FACTORY_API_BASE',
  'FACTORY_WORKER_ID',
  'MUAPI_API_KEY',
  'MUAPI_KLING_SLUG',
  'FACTORY_CLIP_UNIT_COST_USD',
  'STUDIO_ROOT',
  'MAKE_PROMO_PATH',
  'FACTORY_CLIENT_STUDIO',
  'FACTORY_RECIPE_APPROVED_MAKE_PROMO_SHA256',
  'FACTORY_MUSIC_LIBRARY_PATH',
  'FACTORY_BGM_PATH',
  'NEXT_PUBLIC_SUPABASE_URL',
])
const ENDPOINT_OVERRIDE_KEYS = Object.freeze([
  'INNGEST_BASE_URL',
  'INNGEST_EVENT_API_BASE_URL',
  'INNGEST_API_BASE_URL',
  'INNGEST_DEVSERVER_URL',
])

export function loadWorkflowEnv(envPath = process.env.CTS_INNGEST_ENV_FILE || join(import.meta.dirname, '.env')) {
  const fromFile = {}
  const forbidden = []
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!match) continue
      const key = match[1]
      const value = match[2].replace(/^["']|["']$/g, '')
      if (WORKFLOW_ENV_KEYS.includes(key)) fromFile[key] = value
      if (ENDPOINT_OVERRIDE_KEYS.includes(key) && value.trim() !== '') forbidden.push(key)
    }
  }
  const env = {}
  for (const key of WORKFLOW_ENV_KEYS) {
    const value = process.env[key] ?? fromFile[key]
    if (value !== undefined) env[key] = value
  }
  env.__forbiddenEndpointOverrides = [...new Set([
    ...forbidden,
    ...ENDPOINT_OVERRIDE_KEYS.filter((key) => String(process.env[key] ?? '').trim() !== ''),
  ])]
  return env
}

export function requireWorkflowEnv(env) {
  const required = [
    'INNGEST_EVENT_KEY',
    'INNGEST_SIGNING_KEY',
    'CTS_INNGEST_CLIENT_ID',
    'CTS_INNGEST_RECIPE_ID',
    'CTS_INNGEST_MAX_PROVIDER_USD',
  ]
  const missing = required.filter((key) => typeof env[key] !== 'string' || env[key].trim() === '')
  if (missing.length > 0) throw new Error(`Missing CTS workflow environment: ${missing.join(', ')}`)
  if (String(env.INNGEST_DEV ?? '0') !== '0') throw new Error('CTS workflow requires INNGEST_DEV=0')
  if (env.__forbiddenEndpointOverrides?.length > 0) {
    throw new Error(`CTS workflow rejects endpoint override: ${env.__forbiddenEndpointOverrides.join(', ')}`)
  }
  const maxProviderUsd = Number(env.CTS_INNGEST_MAX_PROVIDER_USD)
  if (!Number.isFinite(maxProviderUsd) || maxProviderUsd <= 0 || maxProviderUsd > 25) {
    throw new Error('CTS_INNGEST_MAX_PROVIDER_USD must be > 0 and <= 25')
  }
  return {
    clientId: assertSafeId(env.CTS_INNGEST_CLIENT_ID, 'CTS_INNGEST_CLIENT_ID'),
    recipeId: assertSafeId(env.CTS_INNGEST_RECIPE_ID, 'CTS_INNGEST_RECIPE_ID'),
    maxProviderUsd,
  }
}

export function createRequestData({ requestId, clientId, recipeId, maxProviderUsd }) {
  return {
    schema_version: CTS_WORKFLOW_SCHEMA_VERSION,
    workflow_version: CTS_WORKFLOW_VERSION,
    request_id: assertSafeId(requestId, 'request_id'),
    client_id: assertSafeId(clientId, 'client_id'),
    recipe_id: assertSafeId(recipeId, 'recipe_id'),
    max_provider_usd: assertFinitePositive(maxProviderUsd, 'max_provider_usd'),
    candidate_limit: 1,
    no_publish: true,
  }
}

export function validateRequestData(data, scope) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid CTS workflow request')
  const parsed = createRequestData({
    requestId: data.request_id,
    clientId: data.client_id,
    recipeId: data.recipe_id,
    maxProviderUsd: data.max_provider_usd,
  })
  if (data.schema_version !== CTS_WORKFLOW_SCHEMA_VERSION
      || data.workflow_version !== CTS_WORKFLOW_VERSION
      || data.candidate_limit !== 1
      || data.no_publish !== true) {
    throw new Error('CTS workflow requires schema v1, one candidate, and no_publish=true')
  }
  if (parsed.client_id !== scope.clientId) throw new Error('CTS workflow client scope mismatch')
  if (parsed.recipe_id !== scope.recipeId) throw new Error('CTS workflow recipe scope mismatch')
  if (parsed.max_provider_usd > scope.maxProviderUsd) throw new Error('CTS workflow provider budget exceeds configured cap')
  return parsed
}

export function validateRecipeCodeGate(request, resolver = resolveRecipe) {
  const recipe = resolver(request.recipe_id)
  if (!recipe) return { ok: false, reason: `recipe_not_registered:${request.recipe_id}` }
  const durations = recipe.segments?.map((segment) => Number(segment.duration_hint_s)) ?? []
  if (durations.length < 2 || durations.some((seconds) => !Number.isFinite(seconds) || seconds <= 0 || seconds > 4)) {
    return { ok: false, reason: 'i2v_display_duration_gate' }
  }
  const finalDuration = computeRecipeFinalDuration(recipe)
  if (finalDuration < 8.5 || finalDuration > 9.5) return { ok: false, reason: 'final_duration_gate' }
  if (recipe.tts_enabled !== false || recipe.kenburns !== false) return { ok: false, reason: 'creative_profile_gate' }
  return {
    ok: true,
    recipe: { id: recipe.id, version: recipe.version },
    segment_count: durations.length,
    max_display_seconds: Math.max(...durations),
    final_duration_seconds: finalDuration,
  }
}

export function parseWorkerResult(stdout) {
  const lines = String(stdout ?? '').split('\n').filter((line) => line.startsWith('FACTORY_WORKER_RESULT '))
  if (lines.length !== 1) throw new Error(`Expected one FACTORY_WORKER_RESULT line, got ${lines.length}`)
  let parsed
  try {
    parsed = JSON.parse(lines[0].slice('FACTORY_WORKER_RESULT '.length))
  } catch {
    throw new Error('Malformed FACTORY_WORKER_RESULT JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid worker result')
  return parsed
}

export function runCandidateWorker(request, env, spawnFn = spawnSync, recipeResolver = resolveRecipe) {
  if (typeof env.FACTORY_WORKER_TOKEN !== 'string' || env.FACTORY_WORKER_TOKEN.trim() === '') {
    throw new Error('Missing CTS generation environment: FACTORY_WORKER_TOKEN')
  }
  const workerPath = join(import.meta.dirname, 'worker.mjs')
  const recipe = recipeResolver(request.recipe_id)
  if (!recipe) throw new Error(`CTS recipe disappeared after code gate: ${request.recipe_id}`)
  const childEnv = { ...process.env }
  for (const key of ['INNGEST_EVENT_KEY', 'INNGEST_SIGNING_KEY', 'INNGEST_SIGNING_KEY_FALLBACK']) {
    delete childEnv[key]
  }
  for (const key of WORKFLOW_ENV_KEYS) {
    if (!key.startsWith('INNGEST_') && !key.startsWith('CTS_INNGEST_') && env[key] !== undefined) {
      childEnv[key] = String(env[key])
    }
  }
  const result = spawnFn(process.execPath, [workerPath, '--json-result'], {
    cwd: import.meta.dirname,
    encoding: 'utf8',
    timeout: 30 * 60 * 1000,
    maxBuffer: 8 * 1024 * 1024,
    env: {
      ...childEnv,
      FACTORY_WORKER_TARGET_CLIENT_ID: request.client_id,
      FACTORY_ORCHESTRATOR_MAX_PROVIDER_USD: String(request.max_provider_usd),
      FACTORY_ORCHESTRATOR_REQUIRED_RECIPE_ID: recipe.id,
      FACTORY_ORCHESTRATOR_REQUIRED_RECIPE_VERSION: String(recipe.version),
    },
  })
  if (result.error) throw new Error(`CTS worker launch failed: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`CTS worker exited ${result.status}: ${String(result.stderr ?? '').slice(-500)}`)
  const receipt = parseWorkerResult(result.stdout)
  if (receipt.claimed !== true) throw new Error('CTS worker found no queued work order')
  if (receipt.client_id !== request.client_id) throw new Error('CTS worker returned a different client')
  if (receipt.ok !== true || receipt.status !== 'in_review') throw new Error(`CTS worker failed: ${receipt.error ?? receipt.status}`)
  const cost = Number(receipt.actual_cost_usd)
  if (!Number.isFinite(cost) || cost < 0 || cost > request.max_provider_usd) {
    throw new Error('CTS worker result exceeds provider budget')
  }
  return receipt
}

export function validateReviewData(data, request, candidate) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid CTS review event')
  if (data.verdict !== 'pass' && data.verdict !== 'fail') throw new Error('CTS verdict must be pass or fail')
  for (const [field, expected] of [
    ['request_id', request.request_id],
    ['client_id', request.client_id],
    ['recipe_id', request.recipe_id],
    ['work_order_id', candidate.work_order_id],
  ]) {
    if (assertSafeId(data[field], field) !== expected) throw new Error(`CTS review ${field} mismatch`)
  }
  if (data.schema_version !== 1 || data.no_publish !== true) throw new Error('CTS review must preserve no_publish=true')
  return { ...request, work_order_id: candidate.work_order_id, verdict: data.verdict }
}

export function reviewMatchExpression() {
  return [
    'event.data.request_id == async.data.request_id',
    'event.data.client_id == async.data.client_id',
    'event.data.recipe_id == async.data.recipe_id',
    'async.data.schema_version == 1',
    'async.data.no_publish == true',
    '(async.data.verdict == "pass" || async.data.verdict == "fail")',
  ].join(' && ')
}

export function createCtsWorkflowFunction(client, scope, receiptDir, env, adapters = {}) {
  const runWorker = adapters.runWorker ?? ((request) => runCandidateWorker(request, env))
  return client.createFunction(
    {
      id: 'cts-one-candidate-no-publish',
      name: 'CTS one candidate — code gate to Ray review',
      retries: 0,
      idempotency: 'event.data.request_id',
      concurrency: { limit: 1, key: 'event.data.client_id' },
    },
    { event: CTS_REQUEST_EVENT },
    async ({ event, step }) => {
      const request = await step.run('validate-client-budget-and-no-publish', () =>
        validateRequestData(event.data, scope))
      const gate = await step.run('validate-recipe-code-gate', () => validateRecipeCodeGate(request))
      if (!gate.ok) {
        await step.run('persist-blocked-code-gate', () =>
          persistReceipt(receiptDir, `${request.request_id}.blocked.json`, { ...request, status: 'blocked_code_gate', gate }))
        return { status: 'blocked_code_gate', request_id: request.request_id, reason: gate.reason }
      }
      const candidate = await step.run('generate-exactly-one-candidate', () => {
        const result = runWorker(request)
        persistReceipt(receiptDir, `${request.request_id}.candidate.json`, {
          ...request,
          ...result,
          status: 'waiting_ray_review',
        })
        return result
      })
      const reviewed = await step.waitForEvent('wait-for-ray-review', {
        event: CTS_REVIEW_EVENT,
        timeout: '7d',
        if: reviewMatchExpression(),
      })
      if (!reviewed) return { status: 'review_timed_out', request_id: request.request_id, work_order_id: candidate.work_order_id }
      const review = await step.run('validate-ray-review', () => validateReviewData(reviewed.data, request, candidate))
      return await step.run('persist-review-no-publish', () =>
        persistReceipt(receiptDir, `${request.request_id}.review.json`, {
          ...review,
          status: review.verdict === 'pass' ? 'visual_pass_no_publish' : 'visual_fail_no_publish',
        }))
    },
  )
}

export function resolveWorkflowStateDir(userHome = homedir()) {
  return join(userHome, 'Library', 'Application Support', 'Magic Engine', 'inngest-cts-workflow')
}

async function main() {
  const env = loadWorkflowEnv()
  const scope = requireWorkflowEnv(env)
  hydrateInngestEnv(env)
  const receiptDir = resolveWorkflowStateDir()
  const client = new Inngest({ id: 'magic-engine-cts-workflow', appVersion: CTS_WORKFLOW_VERSION })
  const mode = process.argv[2]
  if (mode === 'connect') {
    const fn = createCtsWorkflowFunction(client, scope, receiptDir, env)
    const connection = await connect({
      apps: [{ client, functions: [fn] }],
      instanceId: `cts-workflow-${hostname()}`,
      maxWorkerConcurrency: 1,
    })
    console.log(JSON.stringify({ status: connection.state, client_id: scope.clientId, candidate_limit: 1, no_publish: true }))
    await connection.closed
    return
  }
  if (mode === 'start') {
    const request = createRequestData({
      requestId: `cts-${randomUUID()}`,
      clientId: scope.clientId,
      recipeId: scope.recipeId,
      maxProviderUsd: scope.maxProviderUsd,
    })
    persistReceipt(receiptDir, `${request.request_id}.request.json`, request)
    replaceReceipt(receiptDir, 'latest-request.json', request)
    await client.send({ id: `cts:start:${request.request_id}`, name: CTS_REQUEST_EVENT, data: request })
    console.log(JSON.stringify({ status: 'request_sent', ...request }))
    return
  }
  if (mode === 'review') {
    const verdict = process.argv[3]
    const request = readJson(join(receiptDir, 'latest-request.json'))
    const candidate = readJson(join(receiptDir, `${request.request_id}.candidate.json`))
    const review = validateReviewData({
      schema_version: 1,
      no_publish: true,
      request_id: request.request_id,
      client_id: request.client_id,
      recipe_id: request.recipe_id,
      work_order_id: candidate.work_order_id,
      verdict,
    }, request, candidate)
    await client.send({ id: `cts:review:${request.request_id}`, name: CTS_REVIEW_EVENT, data: review })
    console.log(JSON.stringify({ status: 'review_sent', request_id: request.request_id, verdict, no_publish: true }))
    return
  }
  throw new Error('Usage: inngest-cts-workflow.mjs <connect|start|review pass|review fail>')
}

export function persistReceipt(receiptDir, filename, value) {
  const path = join(receiptDir, filename)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  let fd
  try {
    fd = openSync(path, 'wx', 0o600)
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`)
    fsyncSync(fd)
    closeSync(fd)
    return value
  } catch (error) {
    if (fd !== undefined) closeQuietly(fd)
    if (error?.code !== 'EEXIST') throw error
    const existing = readJson(path)
    if (JSON.stringify(existing) !== JSON.stringify(value)) throw new Error(`CTS workflow receipt conflict: ${filename}`)
    return existing
  }
}

export function replaceReceipt(receiptDir, filename, value) {
  const path = join(receiptDir, filename)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  let fd
  try {
    fd = openSync(tempPath, 'wx', 0o600)
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`)
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    renameSync(tempPath, path)
    return value
  } catch (error) {
    if (fd !== undefined) closeQuietly(fd)
    try { if (existsSync(tempPath)) unlinkSync(tempPath) } catch { /* preserve primary error */ }
    throw error
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new Error(`Missing or corrupt CTS workflow state: ${path}`)
  }
}

function assertSafeId(value, field) {
  if (typeof value !== 'string' || !SAFE_ID_RE.test(value)) throw new Error(`Invalid ${field}`)
  return value
}

function assertFinitePositive(value, field) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid ${field}`)
  return n
}

function hydrateInngestEnv(env) {
  for (const key of ENDPOINT_OVERRIDE_KEYS) delete process.env[key]
  process.env.INNGEST_EVENT_KEY = env.INNGEST_EVENT_KEY
  process.env.INNGEST_SIGNING_KEY = env.INNGEST_SIGNING_KEY
  process.env.INNGEST_DEV = '0'
}

function closeQuietly(fd) {
  try { closeSync(fd) } catch { /* primary error is more useful */ }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`CTS_INNGEST_ERROR: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
