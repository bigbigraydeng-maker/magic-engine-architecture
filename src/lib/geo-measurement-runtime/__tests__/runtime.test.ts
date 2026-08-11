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
    for (const o of stored.observations) {
      expect(o.outcome.ok).toBe(true)
      expect(o.acquisition.engineFamily).toEqual({ known: true, value: 'openai' })
      expect(o.acquisition.market).toEqual({ known: true, value: 'nz' })
      expect(o.acquisition.sample.samplePlan).toEqual({ known: true, value: { plannedCount: 3 } })
    }
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
    const failed = stored.observations.filter((o) => !o.outcome.ok)
    expect(failed).toHaveLength(1)
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
    expect(o.outcome.ok).toBe(false)
    if (!o.outcome.ok) expect(o.outcome.errorCode).toBe('provider_timeout_ambiguous_no_replay')
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
    const o = stored.observations[0]
    if (!o.outcome.ok) expect(o.outcome.errorCode).toBe('budget_exhausted_no_retry')
    expect(res.stopReason.code).toBe('budget_exhausted_mid_run')
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
