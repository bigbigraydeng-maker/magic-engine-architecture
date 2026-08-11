/**
 * 运行时端到端 —— 授权评论列出的全部必测项（Issue #874 / WP04）：
 * plan validation · cohort identity · bounded batches · budget refusal & mid-run stop ·
 * preflight before billable retry · timeout/rate-limit/parser/provider ambiguity ·
 * no evidence for failed · required evidence for success · persistence atomicity/failure ·
 * duplicate-run · coverage accounting · WP02 comparability handoff。
 */

import { describe, it, expect } from 'vitest'
import { evaluateGeoComparability } from '@/lib/geo-measurement'
import {
  GeoFakeProvider,
  alwaysOkProvider,
  createSequentialIdFactory,
  fixedClock,
  makeFakeParser,
} from '../fake-provider'
import { GeoFakeStore } from '../fake-store'
import { GeoPlanRejectedError, runGeoMeasurementBatch } from '../runtime'
import type { GeoFrozenPlan, GeoProvider, GeoRuntimeDeps } from '../types'

function plan(over: Partial<GeoFrozenPlan> = {}): GeoFrozenPlan {
  return {
    clientId: 'client-1',
    querySetId: 'qs-1',
    querySetVersion: 'v1',
    queries: [{ queryKey: 'q1', questionText: 'best tours in NZ?' }],
    engineFamily: 'openai',
    modelVersion: 'gpt-4o-search-preview',
    locale: 'en-NZ',
    market: 'nz',
    sampleCount: 3,
    samplingParameters: { known: false, reason: 'not_recorded_by_source' },
    parserVersion: 'p1',
    metricRulesVersion: 'm1',
    budgetUsd: 10,
    perObservationCostCeilingUsd: 0.05,
    maxAttemptsPerObservation: 3,
    triggeredBy: { known: true, value: 'test' },
    ...over,
  }
}

function deps(over: Partial<GeoRuntimeDeps> = {}): GeoRuntimeDeps {
  return {
    provider: alwaysOkProvider('openai', 0.01),
    parse: makeFakeParser(),
    store: new GeoFakeStore(),
    now: fixedClock(),
    newId: createSequentialIdFactory(),
    ...over,
  }
}

describe('runGeoMeasurementBatch —— 计划闸门', () => {
  it('非法计划直接抛 GeoPlanRejectedError，且一个 provider 都没调过', async () => {
    const provider = alwaysOkProvider('openai')
    await expect(runGeoMeasurementBatch(plan({ sampleCount: 0 }), deps({ provider }))).rejects.toBeInstanceOf(
      GeoPlanRejectedError,
    )
    expect(provider.callCount).toBe(0)
  })
})

describe('runGeoMeasurementBatch —— 成功路径与 cohort identity', () => {
  it('全成功 → completed，覆盖账吻合，成功观测必带证据，cohort 身份全部 known', async () => {
    const d = deps()
    const res = await runGeoMeasurementBatch(plan(), d)

    expect(res.status).toBe('completed')
    expect(res.persisted).toBe(true)
    expect(res.stopReason.code).toBe('plan_completed')
    expect(res.plannedCoverage.attempted).toBe(3)
    expect(res.actualCoverage).toMatchObject({ attempted: 3, succeeded: 3, failed: 0 })
    expect(res.costUsd).toEqual({ known: true, value: 0.03 })

    const store = d.store as GeoFakeStore
    const stored = store.getBatch(res.batchId)!
    expect(stored.observations).toHaveLength(3)
    expect(stored.evidence).toHaveLength(3) // 每条成功观测一条证据

    // 落进去的是 WP03 的行，不是 domain 对象的副本。
    expect(stored.batch.client_id).toBe('client-1')
    expect(stored.batch.query_set_id).toBe('qs-1')
    expect(stored.batch.status).toBe('completed')
    for (const o of stored.observations) {
      expect(o.outcome_ok).toBe(true)
      expect(o.error_code).toBeNull()
      expect(o.client_id).toBe('client-1')
      expect(o.batch_id).toBe(res.batchId)
      expect(o.engine_family).toBe('openai')
      expect(o.engine_family_unknown_reason).toBeNull()
      expect(o.market).toBe('nz')
      expect(o.locale).toBe('en-NZ')
      expect(o.sample_planned_count).toBe(3)
      expect(o.source_observation_id).toBeNull() // 正常采集恒为 null
      // 计划里的采样参数是显式未知 → 值列为空、理由列有值
      expect(o.sampling_parameters).toBeNull()
      expect(o.sampling_parameters_unknown_reason).toBe('not_recorded_by_source')
    }
  })

  it('成功证据在 store 里保留了真实 raw_response，定位符有兜底数据', async () => {
    const d = deps({ provider: alwaysOkProvider('openai', 0.01) })
    const res = await runGeoMeasurementBatch(plan({ sampleCount: 1 }), d)
    const stored = (d.store as GeoFakeStore).getBatch(res.batchId)!
    const evi = stored.evidence[0]

    expect(evi.raw_response).toBe('answer for q1#0') // 逐字保留，不是空壳
    expect(evi.raw_response_unknown_reason).toBeNull()
    expect(evi.raw_response_locator).toBe(`db://public.geo_evidence/${evi.id}/raw_response`)
    expect(evi.client_id).toBe('client-1')
    expect(evi.observation_id).toBe(stored.observations[0].id)
    expect(Array.isArray(evi.citations)).toBe(true)
  })
})

describe('runGeoMeasurementBatch —— provider 装配闸', () => {
  it('注入的 provider 引擎与计划不符 → 拒跑，callCount=0、一行都不写', async () => {
    const provider = alwaysOkProvider('perplexity') // 计划声明的是 openai
    const store = new GeoFakeStore()
    await expect(runGeoMeasurementBatch(plan(), deps({ provider, store }))).rejects.toMatchObject({
      code: 'provider_engine_mismatch',
    })
    expect(provider.callCount).toBe(0)
    expect(await store.listBatchIds('client-1')).toHaveLength(0)
  })
})

describe('runGeoMeasurementBatch —— 失败绝不写成成功', () => {
  it('provider 明确错误 → 该观测 ok:false，无证据，status partial', async () => {
    const provider = new GeoFakeProvider({
      engineFamily: 'openai',
      idempotency: 'not_applicable',
      script: (r) =>
        r.sampleIndex === 1
          ? { kind: 'error', errorCode: 'server_error', message: '500', costUsd: 0.01 }
          : { kind: 'ok', rawResponse: 'ans', costUsd: 0.01 },
    })
    const d = deps({ provider })
    const res = await runGeoMeasurementBatch(plan(), d)

    expect(res.status).toBe('partial')
    expect(res.actualCoverage).toMatchObject({ attempted: 3, succeeded: 2, failed: 1 })
    const stored = (d.store as GeoFakeStore).getBatch(res.batchId)!
    const failed = stored.observations.filter((o) => !o.outcome_ok)
    expect(failed).toHaveLength(1)
    expect(failed[0].error_code).toBe('server_error')
    expect(stored.evidence).toHaveLength(2) // 失败观测没有证据
    expect(res.stopReason.observedErrorCodes).toContain('server_error')
  })

  it('parser 失败 → 观测失败、无证据，但钱照花（不因失败就假装没调用）', async () => {
    const provider = alwaysOkProvider('openai', 0.02)
    const d = deps({ provider, parse: makeFakeParser({ failWhen: () => true }) })
    const res = await runGeoMeasurementBatch(plan({ sampleCount: 1 }), d)

    expect(res.status).toBe('failed')
    expect(res.actualCoverage).toMatchObject({ attempted: 1, succeeded: 0, failed: 1 })
    expect(res.costUsd).toEqual({ known: true, value: 0.02 }) // 已收费
    expect(res.comparabilityInputs).toHaveLength(0)
    expect(res.stopReason.observedErrorCodes).toContain('parser_failure:unparseable_response')
  })

  it('全部失败 → status failed，comparabilityInputs 为空', async () => {
    const provider = new GeoFakeProvider({
      engineFamily: 'openai',
      idempotency: 'not_applicable',
      script: () => ({ kind: 'error', errorCode: 'boom', message: 'x', costUsd: 0 }),
    })
    const res = await runGeoMeasurementBatch(plan(), deps({ provider }))
    expect(res.status).toBe('failed')
    expect(res.comparabilityInputs).toHaveLength(0)
    expect(res.stopReason.code).toBe('all_attempts_failed')
  })
})

describe('runGeoMeasurementBatch —— 限流 / 超时 / 幂等', () => {
  it('限流后重试成功（限流未收费，重放安全）', async () => {
    const provider = new GeoFakeProvider({
      engineFamily: 'openai',
      idempotency: 'not_applicable',
      script: (_r, attempt) =>
        attempt === 1 ? { kind: 'rate_limited', message: '429' } : { kind: 'ok', rawResponse: 'ans', costUsd: 0.01 },
    })
    const res = await runGeoMeasurementBatch(plan({ sampleCount: 1 }), deps({ provider }))
    expect(res.status).toBe('completed')
    expect(provider.callCount).toBe(2) // 首次限流 + 一次重试
  })

  it('超时 + provider 幂等 supported → 自动重放；第二次成功', async () => {
    const provider = new GeoFakeProvider({
      engineFamily: 'openai',
      idempotency: 'supported',
      script: (_r, attempt) =>
        attempt === 1
          ? { kind: 'timeout', message: 't/o', costUsd: { known: false, reason: 'source_ambiguous' } }
          : { kind: 'ok', rawResponse: 'ans', costUsd: 0.01 },
    })
    const res = await runGeoMeasurementBatch(plan({ sampleCount: 1 }), deps({ provider }))
    expect(res.status).toBe('completed')
    expect(provider.callCount).toBe(2)
    // 首次超时计费歧义 → 整批成本记为显式未知
    expect(res.costUsd).toEqual({ known: false, reason: 'source_ambiguous' })
  })

  it('超时 + provider 幂等 unsupported → 不自动重放，记诚实失败', async () => {
    const provider = new GeoFakeProvider({
      engineFamily: 'openai',
      idempotency: 'unsupported',
      script: () => ({ kind: 'timeout', message: 't/o', costUsd: { known: false, reason: 'source_ambiguous' } }),
    })
    const d = deps({ provider })
    const res = await runGeoMeasurementBatch(plan({ sampleCount: 1 }), d)

    expect(provider.callCount).toBe(1) // 绝不重放
    expect(res.status).toBe('failed')
    const stored = (d.store as GeoFakeStore).getBatch(res.batchId)!
    const o = stored.observations[0]
    expect(o.outcome_ok).toBe(false)
    expect(o.error_code).toBe('provider_timeout_ambiguous_no_replay')
    expect(res.costUsd).toEqual({ known: false, reason: 'source_ambiguous' })
  })
})

describe('runGeoMeasurementBatch —— 预算', () => {
  it('第一次调用前预算就不够 → 一个都没跑，status failed，stop=before_first_call', async () => {
    const provider = alwaysOkProvider('openai', 0.05)
    const d = deps({ provider })
    const res = await runGeoMeasurementBatch(plan({ budgetUsd: 0.04, perObservationCostCeilingUsd: 0.05 }), d)

    expect(provider.callCount).toBe(0)
    expect(res.status).toBe('failed')
    expect(res.actualCoverage.attempted).toBe(0)
    expect(res.stopReason.code).toBe('budget_exhausted_before_first_call')
    expect(res.persisted).toBe(true) // 空批次也如实落库（跑过、什么都没得到）
  })

  it('中途用完预算 → partial + mid_run，实际覆盖 < 计划覆盖', async () => {
    const provider = alwaysOkProvider('openai', 0.05)
    const res = await runGeoMeasurementBatch(
      plan({ budgetUsd: 0.1, perObservationCostCeilingUsd: 0.05, sampleCount: 3 }),
      deps({ provider }),
    )
    expect(res.status).toBe('partial')
    expect(res.actualCoverage).toMatchObject({ attempted: 2, succeeded: 2 })
    expect(res.plannedCoverage.attempted).toBe(3)
    expect(res.stopReason.code).toBe('budget_exhausted_mid_run')
    expect(provider.callCount).toBe(2)
  })

  it('每次可能收费的重试前重新 preflight —— 预算拦住重放', async () => {
    // 预算只够一次调用；首次超时(已按上界计账)想重放，重试前 preflight 判定不够，拦下。
    const provider = new GeoFakeProvider({
      engineFamily: 'openai',
      idempotency: 'supported',
      script: () => ({ kind: 'timeout', message: 't/o', costUsd: { known: false, reason: 'source_ambiguous' } }),
    })
    const d = deps({ provider })
    const res = await runGeoMeasurementBatch(
      plan({ sampleCount: 1, budgetUsd: 0.05, perObservationCostCeilingUsd: 0.05, maxAttemptsPerObservation: 3 }),
      d,
    )
    expect(provider.callCount).toBe(1) // 想重放，但重试前 preflight 拦下
    const stored = (d.store as GeoFakeStore).getBatch(res.batchId)!
    expect(stored.observations[0].error_code).toBe('budget_exhausted_no_retry')
    expect(res.stopReason.code).toBe('budget_exhausted_mid_run')
  })
})

describe('runGeoMeasurementBatch —— WP02 校验由 runtime 自己把关', () => {
  it('观测不合 WP02 契约 → runtime 在调 store 之前就炸，store 一次都没被调用', async () => {
    // 🔴 这条证明的是「契约闸门不挂在某个 store 实现上」：即使 store 完全不校验，
    //    runtime 也必须拦住。用一个**什么都不验**的 store 才测得出这件事。
    const calls: unknown[] = []
    const permissiveStore = {
      persistBatch: async (input: unknown) => {
        calls.push(input)
      },
      listBatchIds: async () => [],
    }
    // parser 给出越界置信度 1.5（WP02 要求 [0,1] 的有限比率）
    const d = deps({ store: permissiveStore, parse: makeFakeParser({ confidence: 1.5 }) })

    await expect(runGeoMeasurementBatch(plan({ sampleCount: 1 }), d)).rejects.toMatchObject({
      code: 'invalid_observation',
    })
    expect(calls).toHaveLength(0) // store 一次都没被调用
  })
})

describe('runGeoMeasurementBatch —— provider 报的成本不可信任', () => {
  // 每一个都是真实的污染手法：NaN 让后续所有预算比较恒为 false（闸门静默失效）；
  // Infinity/超上界是花了没批过的钱；负数等于把钱「还」回来、凭空扩大额度。
  const poisons: readonly (readonly [string, number])[] = [
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['负数', -5],
    ['超过声明上界', 0.5], // ceiling = 0.05
  ]

  for (const [label, poisoned] of poisons) {
    it(`ok 结果携带 ${label} 成本 → 立即停跑、不污染预算账、观测记 provider_cost_untrusted`, async () => {
      const provider = new GeoFakeProvider({
        engineFamily: 'openai',
        idempotency: 'not_applicable',
        script: () => ({ kind: 'ok', rawResponse: 'ans', costUsd: poisoned }),
      })
      const d = deps({ provider })
      const res = await runGeoMeasurementBatch(plan({ sampleCount: 5 }), d)

      // 停跑：第一条之后不再发起任何调用（否则会一路把 5 条跑完）
      expect(provider.callCount).toBe(1)
      expect(res.stopReason.code).toBe('provider_cost_untrusted')
      expect(res.status).toBe('failed')
      expect(res.actualCoverage).toMatchObject({ attempted: 1, succeeded: 0, failed: 1 })

      // 不污染预算账：成本记为显式未知，绝不是一个被 NaN/负数带歪的数字
      expect(res.costUsd).toEqual({ known: false, reason: 'source_ambiguous' })

      const stored = (d.store as GeoFakeStore).getBatch(res.batchId)!
      expect(stored.observations[0].error_code).toBe('provider_cost_untrusted')
      expect(stored.evidence).toHaveLength(0) // 失败观测没有证据
      // 库层「花费必须是真实金额」在行上也成立
      expect(stored.batch.cost_usd).toBeNull()
      expect(stored.batch.cost_usd_unknown_reason).toBe('source_ambiguous')
    })

    it(`error 结果携带 ${label} 成本 → 同样立即停跑`, async () => {
      const provider = new GeoFakeProvider({
        engineFamily: 'openai',
        idempotency: 'not_applicable',
        script: () => ({ kind: 'error', errorCode: 'server_error', message: '500', costUsd: poisoned }),
      })
      const res = await runGeoMeasurementBatch(plan({ sampleCount: 5 }), deps({ provider }))
      expect(provider.callCount).toBe(1)
      expect(res.stopReason.code).toBe('provider_cost_untrusted')
      expect(res.stopReason.observedErrorCodes).toContain('provider_cost_untrusted')
    })

    it(`timeout 结果携带已知但 ${label} 的成本 → 同样立即停跑`, async () => {
      const provider = new GeoFakeProvider({
        engineFamily: 'openai',
        idempotency: 'supported',
        script: () => ({ kind: 'timeout', message: 't/o', costUsd: { known: true, value: poisoned } }),
      })
      const res = await runGeoMeasurementBatch(plan({ sampleCount: 5 }), deps({ provider }))
      expect(provider.callCount).toBe(1) // 即便 idempotency=supported 也不再重放
      expect(res.stopReason.code).toBe('provider_cost_untrusted')
    })
  }

  it('恰好等于上界的成本是可信的（边界不误杀）', async () => {
    const provider = new GeoFakeProvider({
      engineFamily: 'openai',
      idempotency: 'not_applicable',
      script: () => ({ kind: 'ok', rawResponse: 'ans', costUsd: 0.05 }),
    })
    const res = await runGeoMeasurementBatch(
      plan({ sampleCount: 1, perObservationCostCeilingUsd: 0.05, budgetUsd: 1 }),
      deps({ provider }),
    )
    expect(res.status).toBe('completed')
    expect(res.costUsd).toEqual({ known: true, value: 0.05 })
  })

  it('零成本可信（免费额度不是错误）', async () => {
    const provider = new GeoFakeProvider({
      engineFamily: 'openai',
      idempotency: 'not_applicable',
      script: () => ({ kind: 'ok', rawResponse: 'ans', costUsd: 0 }),
    })
    const res = await runGeoMeasurementBatch(plan({ sampleCount: 2 }), deps({ provider }))
    expect(res.status).toBe('completed')
    expect(res.costUsd).toEqual({ known: true, value: 0 })
  })
})

describe('runGeoMeasurementBatch —— 持久化原子性与重复运行', () => {
  it('批次 id 撞车 → 落库抛错，且旧批次一字未动（原子）', async () => {
    const store = new GeoFakeStore()
    let obs = 0
    let evi = 0
    const collidingIds: GeoRuntimeDeps['newId'] = (kind) => {
      if (kind === 'batch') return 'batch-fixed'
      if (kind === 'observation') return `obs-${(obs += 1)}`
      return `evi-${(evi += 1)}`
    }
    const first = await runGeoMeasurementBatch(plan({ sampleCount: 1 }), deps({ store, newId: collidingIds }))
    expect(first.persisted).toBe(true)
    const firstStored = store.getBatch('batch-fixed')

    await expect(
      runGeoMeasurementBatch(plan({ sampleCount: 1 }), deps({ store, newId: collidingIds })),
    ).rejects.toThrow(/immutable/)
    // 撞车后旧批次不变、也没多出新批次
    expect(store.getBatch('batch-fixed')).toBe(firstStored)
    expect(await store.listBatchIds('client-1')).toHaveLength(1)
  })

  it('重复运行同一 cohort → 创建新批次，绝不覆盖旧批次', async () => {
    const store = new GeoFakeStore()
    const newId = createSequentialIdFactory() // 两次运行共用 id 序列 → batch id 各不相同
    const a = await runGeoMeasurementBatch(plan(), deps({ store, newId }))
    const b = await runGeoMeasurementBatch(plan(), deps({ store, newId }))
    expect(a.batchId).not.toBe(b.batchId)
    expect(await store.listBatchIds('client-1')).toHaveLength(2)
  })
})

describe('runGeoMeasurementBatch —— WP02 可比性交接', () => {
  it('两次相同 cohort 的成功观测 → 交给 evaluateGeoComparability 判定为 comparable', async () => {
    const a = await runGeoMeasurementBatch(plan({ sampleCount: 1 }), deps())
    const b = await runGeoMeasurementBatch(plan({ sampleCount: 1 }), deps())
    const verdict = evaluateGeoComparability(a.comparabilityInputs[0], b.comparabilityInputs[0])
    expect(verdict.comparable).toBe(true)
  })

  it('cohort 不同（market 不同）→ WP02 判定 not_comparable', async () => {
    const a = await runGeoMeasurementBatch(plan({ sampleCount: 1, market: 'nz' }), deps())
    const b = await runGeoMeasurementBatch(plan({ sampleCount: 1, market: 'au' }), deps())
    const verdict = evaluateGeoComparability(a.comparabilityInputs[0], b.comparabilityInputs[0])
    expect(verdict.comparable).toBe(false)
  })

  it('质量不达标（置信度低于阈值）→ WP02 判定 not_comparable', async () => {
    const lowConf = deps({ parse: makeFakeParser({ confidence: 0.5 }) })
    const a = await runGeoMeasurementBatch(plan({ sampleCount: 1 }), lowConf)
    const b = await runGeoMeasurementBatch(plan({ sampleCount: 1 }), deps({ parse: makeFakeParser({ confidence: 0.5 }) }))
    const verdict = evaluateGeoComparability(a.comparabilityInputs[0], b.comparabilityInputs[0])
    expect(verdict.comparable).toBe(false)
  })
})
