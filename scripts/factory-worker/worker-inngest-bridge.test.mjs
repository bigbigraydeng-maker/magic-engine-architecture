import assert from 'node:assert/strict'
import test from 'node:test'

import { runOneOrder } from './worker.mjs'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const RECIPE_ID = 'single_image_i2v_multicut_9s'

function order(overrides = {}) {
  return {
    work_order_id: 'wo-1',
    client_id: CLIENT,
    budget_cap_usd: 1,
    brief: { creative_recipe: { id: RECIPE_ID, version: 2 } },
    ...overrides,
  }
}

test('one-order bridge returns a deterministic no-work receipt', async () => {
  assert.deepEqual(await runOneOrder({ claimFn: async () => null }), { claimed: false, ok: true })
})

test('one-order bridge rejects the wrong recipe before processing', async () => {
  const failed = []
  let processed = false
  const result = await runOneOrder({
    claimFn: async () => order({ brief: { creative_recipe: { id: 'legacy-recipe', version: 1 } } }),
    processFn: async () => { processed = true; return { ok: true, cost: 0.5 } },
    failFn: async (...args) => failed.push(args),
    requiredRecipeId: RECIPE_ID,
    requiredRecipeVersion: 2,
    orchestratorMaxProviderUsd: 1,
  })
  assert.equal(processed, false)
  assert.equal(result.error, 'recipe_scope_gate')
  assert.equal(failed.length, 1)
  assert.equal(failed[0][2], false)
})

test('one-order bridge rejects an oversized work order before processing', async () => {
  const failed = []
  let processed = false
  const result = await runOneOrder({
    claimFn: async () => order({ budget_cap_usd: 1.01 }),
    processFn: async () => { processed = true; return { ok: true, cost: 0.5 } },
    failFn: async (...args) => failed.push(args),
    requiredRecipeId: RECIPE_ID,
    requiredRecipeVersion: 2,
    orchestratorMaxProviderUsd: 1,
  })
  assert.equal(processed, false)
  assert.equal(result.error, 'provider_budget_gate')
  assert.equal(failed.length, 1)
})

test('one-order bridge reports recipe cost and review state', async () => {
  const result = await runOneOrder({
    claimFn: async () => order(),
    processFn: async () => ({ ok: true, cost: 0.675 }),
    requiredRecipeId: RECIPE_ID,
    requiredRecipeVersion: 2,
    orchestratorMaxProviderUsd: 1,
  })
  assert.deepEqual(result, {
    claimed: true,
    ok: true,
    work_order_id: 'wo-1',
    client_id: CLIENT,
    actual_cost_usd: 0.675,
    status: 'in_review',
  })
})
