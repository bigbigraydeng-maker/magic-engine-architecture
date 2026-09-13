import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  DAILY_PLAN_READY_EVENT,
  CTS_REQUEST_EVENT,
  CTS_REVIEW_EVENT,
  CTS_REVIEW_MATCH_FIELD,
  createRequestData,
  createCtsWorkflowFunction,
  parseWorkerResult,
  persistReceipt,
  requireWorkflowEnv,
  runCandidateWorker,
  validateRecipeCodeGate,
  validateRequestData,
  validateReviewData,
  validateDailyPlanReadyData,
} from './inngest-cts-workflow.mjs'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const RECIPE_ID = 'single_image_i2v_multicut_9s'
const SCOPE = { clientId: CLIENT, recipeId: RECIPE_ID, maxProviderUsd: 1 }

test('daily plan ready event is constrained to no-publish and stable scope', () => {
  assert.deepEqual(validateDailyPlanReadyData({
    event_name: DAILY_PLAN_READY_EVENT,
    plan_id: 'plan-1',
    campaign_id: 'campaign-1',
    client_id: 'client-1',
    plan_revision: 'rev-1',
    no_publish: true,
  }), {
    event_name: DAILY_PLAN_READY_EVENT,
    plan_id: 'plan-1',
    campaign_id: 'campaign-1',
    client_id: 'client-1',
    plan_revision: 'rev-1',
    no_publish: true,
  })
})

test('daily plan ready event rejects publish-enabled payloads', () => {
  assert.throws(() => validateDailyPlanReadyData({
    event_name: DAILY_PLAN_READY_EVENT,
    plan_id: 'plan-1',
    campaign_id: 'campaign-1',
    client_id: 'client-1',
    no_publish: false,
  }), /no_publish=true/)
})

function request(overrides = {}) {
  return createRequestData({
    requestId: 'cts-request-1',
    clientId: CLIENT,
    recipeId: RECIPE_ID,
    maxProviderUsd: 1,
    ...overrides,
  })
}

function recipe(overrides = {}) {
  return {
    id: RECIPE_ID,
    version: 1,
    segments: [
      { duration_hint_s: 2.6 },
      { duration_hint_s: 2.6 },
      { duration_hint_s: 2.6 },
    ],
    endcard_dur: 2.2,
    xfade: 0.3,
    tts_enabled: false,
    kenburns: false,
    ...overrides,
  }
}

function captureWorkflowHandler(capture) {
  return {
    createFunction: (_options, _trigger, handler) => {
      capture.handler = handler
      return handler
    },
  }
}

function candidateReceipt() {
  return {
    claimed: true,
    ok: true,
    client_id: CLIENT,
    work_order_id: 'wo-1',
    actual_cost_usd: 0.675,
    status: 'in_review',
  }
}

test('request is exactly one candidate and no publish', () => {
  const data = request()
  assert.equal(data.candidate_limit, 1)
  assert.equal(data.no_publish, true)
  assert.deepEqual(validateRequestData(data, SCOPE), data)
  assert.throws(() => validateRequestData({ ...data, no_publish: false }, SCOPE), /no_publish=true/)
  assert.throws(() => validateRequestData({ ...data, candidate_limit: 2 }, SCOPE), /one candidate/)
})

test('client, recipe and provider budget are fail-closed', () => {
  const data = request()
  assert.throws(() => validateRequestData({ ...data, client_id: 'other-client' }, SCOPE), /client scope/)
  assert.throws(() => validateRequestData({ ...data, recipe_id: 'legacy-recipe' }, SCOPE), /recipe scope/)
  assert.throws(() => validateRequestData({ ...data, max_provider_usd: 1.01 }, SCOPE), /budget exceeds/)
})

test('production env requires cloud keys and a bounded cap', () => {
  const good = {
    INNGEST_EVENT_KEY: 'event-key',
    INNGEST_SIGNING_KEY: 'signing-key',
    INNGEST_DEV: '0',
    CTS_INNGEST_CLIENT_ID: CLIENT,
    CTS_INNGEST_RECIPE_ID: RECIPE_ID,
    CTS_INNGEST_MAX_PROVIDER_USD: '1',
    __forbiddenEndpointOverrides: [],
  }
  assert.deepEqual(requireWorkflowEnv(good), SCOPE)
  assert.throws(() => requireWorkflowEnv({ ...good, INNGEST_DEV: '1' }), /INNGEST_DEV=0/)
  assert.throws(() => requireWorkflowEnv({ ...good, CTS_INNGEST_MAX_PROVIDER_USD: '26' }), /<= 25/)
  assert.throws(() => requireWorkflowEnv({ ...good, __forbiddenEndpointOverrides: ['INNGEST_BASE_URL'] }), /endpoint override/)
})

test('code gate rejects missing recipe, long I2V and wrong final duration', () => {
  const data = request()
  assert.deepEqual(validateRecipeCodeGate(data, () => null), {
    ok: false,
    reason: `recipe_not_registered:${RECIPE_ID}`,
  })
  assert.equal(validateRecipeCodeGate(data, () => recipe()).ok, true)
  assert.deepEqual(validateRecipeCodeGate(data, () => recipe({ segments: [{ duration_hint_s: 4.1 }, { duration_hint_s: 2 }] })), {
    ok: false,
    reason: 'i2v_display_duration_gate',
  })
  assert.deepEqual(validateRecipeCodeGate(data, () => recipe({ endcard_dur: 9 })), {
    ok: false,
    reason: 'final_duration_gate',
  })
})

test('worker receipt parser accepts one deterministic JSON result only', () => {
  const line = `log\nFACTORY_WORKER_RESULT ${JSON.stringify({ claimed: true, ok: true })}\n`
  assert.deepEqual(parseWorkerResult(line), { claimed: true, ok: true })
  assert.throws(() => parseWorkerResult('no result'), /got 0/)
  assert.throws(() => parseWorkerResult(`${line}${line}`), /got 2/)
})

test('worker runner enforces client, in_review and provider budget', () => {
  const data = request()
  const workerEnv = {
    FACTORY_WORKER_TOKEN: 'worker-token',
    INNGEST_EVENT_KEY: 'must-not-reach-worker',
    INNGEST_SIGNING_KEY: 'must-not-reach-worker',
  }
  const spawn = (_bin, _args, options) => {
    assert.equal(options.env.FACTORY_WORKER_TARGET_CLIENT_ID, CLIENT)
    assert.equal(options.env.FACTORY_ORCHESTRATOR_MAX_PROVIDER_USD, '1')
    assert.equal(options.env.INNGEST_EVENT_KEY, undefined)
    assert.equal(options.env.INNGEST_SIGNING_KEY, undefined)
    return {
      status: 0,
      stdout: `FACTORY_WORKER_RESULT ${JSON.stringify({
        claimed: true,
        ok: true,
        client_id: CLIENT,
        work_order_id: 'wo-1',
        actual_cost_usd: 0.675,
        status: 'in_review',
      })}\n`,
      stderr: '',
    }
  }
  const resolver = () => recipe()
  assert.equal(runCandidateWorker(data, workerEnv, spawn, resolver).work_order_id, 'wo-1')
  const overBudget = () => ({
    status: 0,
    stdout: `FACTORY_WORKER_RESULT ${JSON.stringify({
      claimed: true, ok: true, client_id: CLIENT, work_order_id: 'wo-1', actual_cost_usd: 1.1, status: 'in_review',
    })}\n`,
    stderr: '',
  })
  assert.throws(() => runCandidateWorker(data, workerEnv, overBudget, resolver), /exceeds provider budget/)
  assert.throws(() => runCandidateWorker(data, {}, spawn, resolver), /FACTORY_WORKER_TOKEN/)
})

test('Ray review is fully correlated and cannot publish', () => {
  const data = request()
  const candidate = { work_order_id: 'wo-1' }
  const review = {
    schema_version: 1,
    no_publish: true,
    request_id: data.request_id,
    client_id: data.client_id,
    recipe_id: data.recipe_id,
    work_order_id: candidate.work_order_id,
    verdict: 'pass',
  }
  assert.equal(validateReviewData(review, data, candidate).verdict, 'pass')
  assert.throws(() => validateReviewData({ ...review, no_publish: false }, data, candidate), /no_publish=true/)
  for (const field of ['request_id', 'client_id', 'recipe_id', 'work_order_id']) {
    assert.throws(
      () => validateReviewData({ ...review, [field]: 'other' }, data, candidate),
      new RegExp(`${field} mismatch`),
    )
  }
  assert.equal(CTS_REVIEW_MATCH_FIELD, 'data.request_id')
})

test('workflow wakes by request id then validates the full review fail-closed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cts-inngest-review-match-'))
  try {
    const capture = {}
    createCtsWorkflowFunction(captureWorkflowHandler(capture), SCOPE, dir, {}, {
      runWorker: candidateReceipt,
    })
    const data = request()
    const review = {
      schema_version: 1,
      no_publish: true,
      request_id: data.request_id,
      client_id: data.client_id,
      recipe_id: data.recipe_id,
      work_order_id: 'wo-1',
      verdict: 'pass',
    }
    let waitOptions
    const step = {
      run: async (_id, fn) => await fn(),
      waitForEvent: async (_id, options) => {
        waitOptions = options
        return { data: review }
      },
    }

    const result = await capture.handler({ event: { data }, step })

    assert.deepEqual(waitOptions, {
      event: CTS_REVIEW_EVENT,
      timeout: '7d',
      match: 'data.request_id',
    })
    assert.equal(result.status, 'visual_pass_no_publish')
    assert.equal(result.verdict, 'pass')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('events are CTS-scoped and workflow source has no publish operation', () => {
  assert.equal(CTS_REQUEST_EVENT, 'me/factory.cts-candidate.requested')
  assert.equal(CTS_REVIEW_EVENT, 'me/factory.cts-candidate.reviewed')
  const source = readFileSync(new URL('./inngest-cts-workflow.mjs', import.meta.url), 'utf8')
  for (const forbidden of ['/api/factory/publish', 'factory-publish-sweeper', 'publish-worker.mjs']) {
    assert.equal(source.includes(forbidden), false)
  }
})

test('receipts are atomic and conflicting rewrites fail closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cts-inngest-workflow-'))
  try {
    assert.deepEqual(persistReceipt(dir, 'x.json', { status: 'one' }), { status: 'one' })
    assert.deepEqual(persistReceipt(dir, 'x.json', { status: 'one' }), { status: 'one' })
    assert.throws(() => persistReceipt(dir, 'x.json', { status: 'two' }), /receipt conflict/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
