/**
 * 真实 WP03 store 判据（Issue #883 / #917 · WP04A）。
 *
 * 🔴 走的是**真链路**：WP04 的 `runGeoMeasurementBatch` + 本模块的 `GeoSupabaseStore`
 *    + 按表建模的假 Supabase。这样断言的是「这套接线真的能把行落对」，
 *    而不是「我写的映射函数返回了我期待的对象」（后者恒为真，一辈子不会响）。
 */

import { describe, expect, it } from 'vitest'
import {
  alwaysOkProvider,
  createSequentialIdFactory,
  fixedClock,
  makeFakeParser,
  runGeoMeasurementBatch,
  GeoFakeProvider,
} from '@/lib/geo-measurement-runtime'
import type { GeoFrozenPlan } from '@/lib/geo-measurement-runtime'
import {
  clampErrorMessage,
  GeoStoreError,
  GeoSupabaseStore,
  MAX_ERROR_MESSAGE_CHARS,
  stripGeneratedColumns,
} from '../store'
import { buildSuccessObservation } from '@/lib/geo-measurement-runtime/observation'
import { FakeSupabase } from './fake-supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

const CLIENT_ID = 'client-1'

function plan(overrides: Partial<GeoFrozenPlan> = {}): GeoFrozenPlan {
  return {
    clientId: CLIENT_ID,
    querySetId: 'qs-1',
    querySetVersion: 'v1',
    queries: [
      { queryKey: 'q1', questionText: 'first?' },
      { queryKey: 'q2', questionText: 'second?' },
    ],
    engineFamily: 'openai',
    modelVersion: 'gpt-4o-search-preview-2025-03-11',
    locale: 'en-NZ',
    market: 'nz',
    sampleCount: 1,
    samplingParameters: { known: false, reason: 'not_recorded_by_source' },
    parserVersion: 'geo-baseline/parser/v1',
    metricRulesVersion: 'geo-baseline/rules/v1',
    budgetUsd: 1,
    perObservationCostCeilingUsd: 0.05,
    maxAttemptsPerObservation: 1,
    triggeredBy: { known: true, value: 'test' },
    ...overrides,
  }
}

function deps(db: FakeSupabase, provider = alwaysOkProvider('openai', 0.01)) {
  return {
    provider,
    parse: makeFakeParser({ confidence: 0.9 }),
    store: new GeoSupabaseStore({
      client: db as unknown as SupabaseClient,
      now: () => '2026-08-12T00:00:00.000Z',
    }),
    now: fixedClock(),
    newId: createSequentialIdFactory(),
  }
}

describe('成功路径：三张表都落对', () => {
  it('批次 / 观测 / 证据各自落到自己的表，且 client_id 与 query_set_id 落对', async () => {
    const db = new FakeSupabase()
    const result = await runGeoMeasurementBatch(plan(), deps(db))

    expect(result.status).toBe('completed')
    expect(db.tables.geo_batches).toHaveLength(1)
    expect(db.tables.geo_observations).toHaveLength(2)
    expect(db.tables.geo_evidence).toHaveLength(2)

    const batch = db.tables.geo_batches[0]
    expect(batch.client_id).toBe(CLIENT_ID)
    expect(batch.query_set_id).toBe('qs-1')
    expect(batch.status).toBe('completed')

    for (const row of db.tables.geo_observations) expect(row.client_id).toBe(CLIENT_ID)
    for (const row of db.tables.geo_evidence) expect(row.client_id).toBe(CLIENT_ID)
  })

  it('写入顺序必须是 批次 → 观测 → 证据（外键与证据触发器钉死了这个顺序）', async () => {
    const db = new FakeSupabase()
    await runGeoMeasurementBatch(plan(), deps(db))
    expect(db.insertPayloads.map((p) => p.table)).toEqual(['geo_batches', 'geo_observations', 'geo_evidence'])
  })

  it('观测与证据各自是一条多行 INSERT，不是逐行插（逐行 = 更多崩溃窗口）', async () => {
    const db = new FakeSupabase()
    await runGeoMeasurementBatch(plan(), deps(db))
    const obs = db.insertPayloads.filter((p) => p.table === 'geo_observations')
    const ev = db.insertPayloads.filter((p) => p.table === 'geo_evidence')
    expect(obs).toHaveLength(1)
    expect(obs[0].rows).toHaveLength(2)
    expect(ev).toHaveLength(1)
    expect(ev[0].rows).toHaveLength(2)
  })

  it('raw_response 逐字落库（没有它，「日后用新 parser 重新解析」是空话）', async () => {
    const db = new FakeSupabase()
    const provider = new GeoFakeProvider({
      engineFamily: 'openai',
      idempotency: 'unsupported',
      script: () => ({ kind: 'ok', rawResponse: '{"envelope":"x","text":"逐字保留"}', costUsd: 0.01 }),
    })
    await runGeoMeasurementBatch(plan({ queries: [{ queryKey: 'q1', questionText: 'a?' }] }), deps(db, provider))
    expect(db.tables.geo_evidence[0].raw_response).toBe('{"envelope":"x","text":"逐字保留"}')
  })
})

describe('GENERATED 列', () => {
  it('raw_response_locator 绝不出现在 INSERT payload 里（Postgres 会直接拒）', async () => {
    const db = new FakeSupabase()
    await runGeoMeasurementBatch(plan(), deps(db))
    const evidenceInserts = db.insertPayloads.filter((p) => p.table === 'geo_evidence')
    for (const payload of evidenceInserts) {
      for (const row of payload.rows) {
        expect(Object.keys(row)).not.toContain('raw_response_locator')
      }
    }
  })

  it('stripGeneratedColumns 摘掉的正是那一列，其余一个不少', () => {
    const stripped = stripGeneratedColumns({
      id: 'e1',
      client_id: 'c',
      observation_id: 'o1',
      raw_response: 'x',
      raw_response_unknown_reason: null,
      raw_response_locator: 'db://…',
      citations: [],
      created_at: 't',
    })
    expect('raw_response_locator' in stripped).toBe(false)
    expect(Object.keys(stripped).sort()).toEqual(
      ['citations', 'client_id', 'created_at', 'id', 'observation_id', 'raw_response', 'raw_response_unknown_reason'].sort(),
    )
  })
})

describe('失败观测不产出证据', () => {
  it('provider 报错 ⇒ 观测行 outcome_ok=false 且没有对应证据行', async () => {
    const db = new FakeSupabase()
    const provider = new GeoFakeProvider({
      engineFamily: 'openai',
      idempotency: 'unsupported',
      script: (req) =>
        req.queryKey === 'q1'
          ? { kind: 'ok', rawResponse: 'ok', costUsd: 0.01 }
          : { kind: 'error', errorCode: 'provider_http_500', message: 'boom', costUsd: 0 },
    })
    const result = await runGeoMeasurementBatch(plan(), deps(db, provider))

    expect(result.status).toBe('partial')
    expect(db.tables.geo_observations).toHaveLength(2)
    expect(db.tables.geo_evidence).toHaveLength(1)
    const failed = db.tables.geo_observations.find((r) => r.outcome_ok === false)
    expect(failed?.error_code).toBe('provider_http_500')
    expect(db.tables.geo_evidence.some((e) => e.observation_id === failed?.id)).toBe(false)
  })
})

describe('崩溃窗口 —— 选路线③ 的全部代价押在这里', () => {
  it('观测写失败 ⇒ 抛错，且明说批次行成了删不掉的孤儿', async () => {
    const db = new FakeSupabase()
    db.failures.push({ table: 'geo_observations', op: 'insert', message: 'connection reset' })
    // 只跑一次 —— 跑第二次会撞上「批次不可变」，把要测的那条错误盖掉。
    const thrown = await runGeoMeasurementBatch(plan(), deps(db)).catch((e: unknown) => e)
    expect(thrown).toBeInstanceOf(GeoStoreError)
    expect(thrown).toMatchObject({ code: 'observations_insert_failed', orphaned: true })
    expect((thrown as GeoStoreError).message).toMatch(/不可删除/)
    // 批次行确实留下了，且删不掉 —— 这条路线的已知代价，钉住它。
    expect(db.tables.geo_batches).toHaveLength(1)
    expect(db.tables.geo_observations).toHaveLength(0)
  })

  it('证据写失败 ⇒ 抛错，且明说「成功观测却没有证据」这种行已经进库了', async () => {
    const db = new FakeSupabase()
    db.failures.push({ table: 'geo_evidence', op: 'insert', message: 'connection reset' })
    await expect(runGeoMeasurementBatch(plan(), deps(db))).rejects.toMatchObject({
      code: 'evidence_insert_failed',
      orphaned: true,
    })
    // 半截数据是真的留下了 —— 这正是这条路线的已知代价，测试把它钉住。
    expect(db.tables.geo_batches).toHaveLength(1)
    expect(db.tables.geo_observations).toHaveLength(2)
    expect(db.tables.geo_evidence).toHaveLength(0)
  })

  it('库悄悄吞掉观测行（写没报错但行不在）⇒ 对账必须发现，不许当成功返回', async () => {
    // 场景要挑全失败的批次：有成功观测的话，证据那一步会先撞上「观测不存在」的外键，
    // 把对账要抓的那件事盖掉 —— 那道闸另有测试。这里要单独测**对账本身**。
    const db = new FakeSupabase()
    db.swallowInsertsFor.add('geo_observations')
    const allFail = new GeoFakeProvider({
      engineFamily: 'openai',
      idempotency: 'unsupported',
      script: () => ({ kind: 'error', errorCode: 'provider_http_500', message: 'boom', costUsd: 0 }),
    })
    const thrown = await runGeoMeasurementBatch(plan(), deps(db, allFail)).catch((e: unknown) => e)
    expect(thrown).toMatchObject({ code: 'coverage_row_count_mismatch', orphaned: true })
  })

  it('观测被吞掉时，证据那一步先撞上「观测不存在」—— 库层这道闸也必须响', async () => {
    const db = new FakeSupabase()
    db.swallowInsertsFor.add('geo_observations')
    const thrown = await runGeoMeasurementBatch(plan(), deps(db)).catch((e: unknown) => e)
    expect(thrown).toMatchObject({ code: 'evidence_insert_failed', orphaned: true })
  })

  it('库悄悄吞掉证据行 ⇒ 对账必须报「成功观测没有证据」', async () => {
    const db = new FakeSupabase()
    db.swallowInsertsFor.add('geo_evidence')
    await expect(runGeoMeasurementBatch(plan(), deps(db))).rejects.toMatchObject({
      code: 'success_observation_without_evidence',
      orphaned: true,
    })
  })

  it('批次写失败 ⇒ 干净失败，一行都没进去，不标 orphaned', async () => {
    const db = new FakeSupabase()
    db.failures.push({ table: 'geo_batches', op: 'insert', message: 'nope' })
    await expect(runGeoMeasurementBatch(plan(), deps(db))).rejects.toMatchObject({
      code: 'batch_insert_failed',
      orphaned: false,
    })
    expect(db.tables.geo_batches).toHaveLength(0)
    expect(db.tables.geo_observations).toHaveLength(0)
  })
})

describe('落库后对账必须拿**读回来的行**比，不是拿内存里的输入自己比自己', () => {
  it('批次行读不回来 ⇒ batch_row_missing', async () => {
    const db = new FakeSupabase()
    db.swallowInsertsFor.add('geo_batches')
    const thrown = await runGeoMeasurementBatch(plan(), deps(db)).catch((e: unknown) => e)
    // 观测的外键在真库里会先炸；这里的假件不建模那条外键，所以直接落到批次对账。
    expect(thrown).toMatchObject({ orphaned: true })
    expect((thrown as GeoStoreError).code).toMatch(/batch_row_missing|coverage_/)
  })

  it('成功数对不上 ⇒ coverage_success_count_mismatch（拿库里的 outcome_ok 分布对账）', async () => {
    const db = new FakeSupabase()
    const store = new GeoSupabaseStore({ client: db as unknown as SupabaseClient, now: () => 't' })
    const built = buildSuccessObservation({
      plan: plan(),
      queryKey: 'q1',
      sampleIndex: 0,
      batchId: 'b-mismatch',
      observationId: 'o-1',
      evidenceId: 'e-1',
      observedAt: '2026-08-12T00:00:00.000Z',
      confidence: 0.9,
      citations: [],
      rawResponse: 'raw',
    })
    // 一条成功观测，但批次自己声称「0 成功 / 1 失败」—— 库里读回来的分布会拆穿它。
    const coverage = {
      engines: ['openai'], models: ['m'], locales: ['en-NZ'], markets: ['nz'], queryKeys: ['q1'],
      attempted: 1, succeeded: 0, failed: 1,
    }
    const thrown = await store
      .persistBatch({
        clientId: CLIENT_ID,
        querySetId: 'qs-1',
        batch: {
          batchId: 'b-mismatch',
          querySetVersion: 'v1',
          startedAt: '2026-08-12T00:00:00.000Z',
          completedAt: { known: true, value: '2026-08-12T00:00:01.000Z' },
          status: 'partial',
          plannedCoverage: coverage,
          actualCoverage: coverage,
          costUsd: { known: true, value: 0.01 },
          triggeredBy: { known: true, value: 'test' },
        },
        observations: [built.observation],
        evidence: [built.evidence],
      })
      .then(() => null)
      .catch((e: unknown) => e)
    expect(thrown).toMatchObject({ code: 'coverage_success_count_mismatch', orphaned: true })
  })

  it('对账阶段读失败 ⇒ orphaned 必须是 true（此时三条 INSERT 已经全成功）', async () => {
    const db = new FakeSupabase()
    const shared = deps(db)
    // 先正常落一批，确认能成功
    await runGeoMeasurementBatch(plan(), shared)
    // 再跑一批，但让对账那一步的读失败
    db.failures.push({ table: 'geo_observations', op: 'select', message: 'connection reset' })
    let n = 0
    const thrown = await runGeoMeasurementBatch(plan({ clientId: 'c2' }), {
      ...deps(db),
      newId: (kind) => `c2-${kind}-${++n}`,
    }).catch((e: unknown) => e)
    expect(thrown).toMatchObject({ code: 'query_failed', orphaned: true })
    expect((thrown as GeoStoreError).message).toMatch(/不要重跑/)
  })
})

describe('error_message 截断（那一列不可变、无长度上限）', () => {
  it('🔴 走 persistBatch 真链路时也截断（直测函数不够 —— 拆掉调用点必须有测试变红）', async () => {
    const db = new FakeSupabase()
    const long = 'E'.repeat(MAX_ERROR_MESSAGE_CHARS + 321)
    const provider = new GeoFakeProvider({
      engineFamily: 'openai',
      idempotency: 'unsupported',
      script: () => ({ kind: 'error', errorCode: 'provider_error', message: long, costUsd: 0 }),
    })
    await runGeoMeasurementBatch(plan(), deps(db, provider))
    for (const row of db.tables.geo_observations) {
      const msg = String(row.error_message)
      expect(msg.length).toBeLessThan(long.length)
      expect(msg).toContain('truncated 321 chars')
    }
  })

  it('超长错误被截断并留痕', () => {
    const long = 'x'.repeat(MAX_ERROR_MESSAGE_CHARS + 500)
    const row = clampErrorMessage({
      id: 'o1', client_id: 'c', batch_id: 'b',
      query_set_version: 'v', query_set_version_unknown_reason: null,
      query_key: 'k', query_key_unknown_reason: null,
      engine_family: 'openai', engine_family_unknown_reason: null,
      model_version: 'm', model_version_unknown_reason: null,
      locale: 'en-NZ', locale_unknown_reason: null,
      market: 'nz', market_unknown_reason: null,
      sample_planned_count: 1, sample_planned_count_unknown_reason: null,
      sample_index: 0, sample_index_unknown_reason: null,
      sampling_parameters: null, sampling_parameters_unknown_reason: 'not_recorded_by_source',
      parser_version: 'p', parser_version_unknown_reason: null,
      metric_rules_version: 'r', metric_rules_version_unknown_reason: null,
      confidence: null, confidence_unknown_reason: 'not_applicable',
      observed_at: 't', outcome_ok: false, error_code: 'e',
      error_message: long, error_message_unknown_reason: null,
      source_observation_id: null, created_at: 't',
    })
    expect(row.error_message).toContain('truncated 500 chars')
    expect((row.error_message ?? '').length).toBeLessThan(long.length)
  })
})

describe('读路径不许把「查炸了」读成「没有」', () => {
  it('listBatchIds 查询报错 ⇒ 抛，绝不 return []', async () => {
    const db = new FakeSupabase()
    db.failures.push({ table: 'geo_batches', op: 'select', message: 'boom' })
    const store = new GeoSupabaseStore({ client: db as unknown as SupabaseClient, now: () => 't' })
    await expect(store.listBatchIds(CLIENT_ID)).rejects.toThrow(/listBatchIds/)
  })

  it('listBatchIds 只返回本客户的批次', async () => {
    const db = new FakeSupabase()
    await runGeoMeasurementBatch(plan(), deps(db))
    // 第二个客户必须用不同的 id 前缀 —— 两个 createSequentialIdFactory() 各自从 1 开始，
    // 直接复用会撞上「批次不可变」，测出来的就不是租户隔离了。
    let n = 0
    await runGeoMeasurementBatch(plan({ clientId: 'other-client' }), {
      ...deps(db),
      newId: (kind) => `other-${kind}-${++n}`,
    })
    const store = new GeoSupabaseStore({ client: db as unknown as SupabaseClient, now: () => 't' })
    expect(await store.listBatchIds(CLIENT_ID)).toHaveLength(1)
    expect(await store.listBatchIds('other-client')).toHaveLength(1)
    expect(await store.listBatchIds('nobody')).toHaveLength(0)
  })
})

describe('不可变性', () => {
  it('同一个批次 id 落两次 ⇒ 被库层拒（重跑必须是新批次）', async () => {
    const db = new FakeSupabase()
    // 两次运行共用同一个 id 工厂 ⇒ 第二次会生成同样的 batch id。
    const shared = deps(db)
    await runGeoMeasurementBatch(plan(), shared)
    await expect(
      runGeoMeasurementBatch(plan(), { ...shared, newId: createSequentialIdFactory() }),
    ).rejects.toMatchObject({ code: 'batch_insert_failed' })
  })
})
