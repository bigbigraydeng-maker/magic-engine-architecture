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

  it('🔴 唯一的写入路径是一次 RPC —— 绝不能退回三条独立 INSERT', async () => {
    const db = new FakeSupabase()
    await runGeoMeasurementBatch(plan(), deps(db))
    // 三条独立 INSERT = 三个事务 = 中途失败留下不可删除的半截证据。
    expect(db.insertPayloads, '不许对 geo_* 表直接 INSERT').toEqual([])
    expect(db.rpcPayloads.map((r) => r.name)).toEqual(['geo_persist_batch_v1'])
  })

  it('一次 RPC 带上整批：批次 + 全部观测 + 全部证据', async () => {
    const db = new FakeSupabase()
    await runGeoMeasurementBatch(plan(), deps(db))
    const params = db.rpcPayloads[0].params as Record<string, unknown>
    expect(params.p_client_id).toBe(CLIENT_ID)
    expect((params.p_observations as unknown[]).length).toBe(2)
    expect((params.p_evidence as unknown[]).length).toBe(2)
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
  it('raw_response_locator 绝不出现在送给 RPC 的证据里（Postgres 会直接拒）', async () => {
    const db = new FakeSupabase()
    await runGeoMeasurementBatch(plan(), deps(db))
    const evidence = db.rpcPayloads[0].params.p_evidence as Record<string, unknown>[]
    expect(evidence.length).toBeGreaterThan(0)
    for (const row of evidence) {
      expect(Object.keys(row)).not.toContain('raw_response_locator')
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

describe('🔴 原子性：任一步失败 ⇒ 三表零新增（Codex 复验要求的六条）', () => {
  async function expectNothingWritten(db: FakeSupabase, run: Promise<unknown>): Promise<GeoStoreError> {
    const thrown = (await run.catch((e: unknown) => e)) as GeoStoreError
    expect(db.tables.geo_batches, 'geo_batches 必须零新增').toEqual([])
    expect(db.tables.geo_observations, 'geo_observations 必须零新增').toEqual([])
    expect(db.tables.geo_evidence, 'geo_evidence 必须零新增').toEqual([])
    return thrown
  }

  it('批次写入失败 ⇒ 三表零新增', async () => {
    const db = new FakeSupabase()
    db.failures.push({ table: 'geo_persist_batch_v1', op: 'rpc', message: 'geo_batches 违反约束' })
    const thrown = await expectNothingWritten(db, runGeoMeasurementBatch(plan(), deps(db)))
    expect(thrown).toMatchObject({ code: 'atomic_persist_failed', committed: false })
    expect(thrown.message).toMatch(/整批已回滚/)
  })

  it('观测写入失败 ⇒ 三表零新增（批次不会被单独留下）', async () => {
    const db = new FakeSupabase()
    db.failures.push({ table: 'geo_persist_batch_v1', op: 'rpc', message: 'geo_observations 违反约束' })
    const thrown = await expectNothingWritten(db, runGeoMeasurementBatch(plan(), deps(db)))
    expect(thrown).toMatchObject({ code: 'atomic_persist_failed', committed: false })
  })

  it('证据写入失败 ⇒ 三表零新增（不会留下「成功观测没有证据」那种毒行）', async () => {
    const db = new FakeSupabase()
    db.failures.push({ table: 'geo_persist_batch_v1', op: 'rpc', message: 'geo_evidence 违反约束' })
    await expectNothingWritten(db, runGeoMeasurementBatch(plan(), deps(db)))
  })

  it('成功路径 ⇒ 三表一次完整写入', async () => {
    const db = new FakeSupabase()
    const result = await runGeoMeasurementBatch(plan(), deps(db))
    expect(result.status).toBe('completed')
    expect(db.tables.geo_batches).toHaveLength(1)
    expect(db.tables.geo_observations).toHaveLength(2)
    expect(db.tables.geo_evidence).toHaveLength(2)
    expect(db.rpcPayloads).toHaveLength(1)
  })

  it('store 侧：三份 payload 的 client_id 恒等于计划里的那一个（租户不可能从映射里跑偏）', async () => {
    const db = new FakeSupabase()
    await runGeoMeasurementBatch(plan(), deps(db))
    const params = db.rpcPayloads[0].params as Record<string, unknown>
    const batch = params.p_batch as Record<string, unknown>
    expect(params.p_client_id).toBe(CLIENT_ID)
    expect(batch.client_id).toBe(CLIENT_ID)
    for (const o of params.p_observations as Record<string, unknown>[]) expect(o.client_id).toBe(CLIENT_ID)
    for (const e of params.p_evidence as Record<string, unknown>[]) expect(e.client_id).toBe(CLIENT_ID)
  })

  it('RPC 侧：批次 client_id 与声明的租户不符 ⇒ 整批回滚，三表零新增', async () => {
    // 🔴 这道闸在 RPC 里（`geo_persist_batch_v1` 的租户闸），所以直测 RPC。
    //    store 自己永远盖同一个 client_id —— 真正的风险是有别的调用方绕过它。
    const db = new FakeSupabase()
    const { error } = await db.rpc('geo_persist_batch_v1', {
      p_client_id: 'declared-client',
      p_batch: { id: 'b-1', client_id: 'other-client', query_set_id: 'qs-1' },
      p_observations: [],
      p_evidence: [],
    })
    expect(error?.message).toMatch(/client_id .* 与调用声明的 .* 不一致/)
    expect(db.tables.geo_batches).toEqual([])
    expect(db.tables.geo_observations).toEqual([])
    expect(db.tables.geo_evidence).toEqual([])
  })

  it('RPC 侧：观测的 client_id / batch_id 与本批次不符 ⇒ 整批回滚', async () => {
    const db = new FakeSupabase()
    const r1 = await db.rpc('geo_persist_batch_v1', {
      p_client_id: 'c1',
      p_batch: { id: 'b-1', client_id: 'c1' },
      p_observations: [{ id: 'o-1', client_id: 'c2', batch_id: 'b-1', outcome_ok: false }],
      p_evidence: [],
    })
    expect(r1.error?.message).toMatch(/观测的 client_id 与本批次不符/)

    const r2 = await db.rpc('geo_persist_batch_v1', {
      p_client_id: 'c1',
      p_batch: { id: 'b-2', client_id: 'c1' },
      p_observations: [{ id: 'o-2', client_id: 'c1', batch_id: 'other-batch', outcome_ok: false }],
      p_evidence: [],
    })
    expect(r2.error?.message).toMatch(/观测的 batch_id 与本批次不符/)

    expect(db.tables.geo_batches).toEqual([])
    expect(db.tables.geo_observations).toEqual([])
  })

  it('RPC 侧：成功观测缺证据 ⇒ 整批回滚（库层拦不住，RPC 在事务内补的那一刀）', async () => {
    const db = new FakeSupabase()
    const { error } = await db.rpc('geo_persist_batch_v1', {
      p_client_id: 'c1',
      p_batch: { id: 'b-1', client_id: 'c1' },
      p_observations: [{ id: 'o-1', client_id: 'c1', batch_id: 'b-1', outcome_ok: true }],
      p_evidence: [],
    })
    expect(error?.message).toMatch(/成功观测没有对应证据行，整批回滚/)
    expect(db.tables.geo_batches).toEqual([])
    expect(db.tables.geo_observations).toEqual([])
  })

  it('重复的不可变观测（同一批次跑两次）⇒ 全部回滚，第一批完好', async () => {
    const db = new FakeSupabase()
    const shared = deps(db)
    await runGeoMeasurementBatch(plan(), shared)
    const before = {
      b: db.tables.geo_batches.length,
      o: db.tables.geo_observations.length,
      e: db.tables.geo_evidence.length,
    }
    // 同一个 id 工厂 ⇒ 第二次生成同样的 batch / observation id。
    const thrown = await runGeoMeasurementBatch(plan(), {
      ...shared,
      newId: createSequentialIdFactory(),
    }).catch((e: unknown) => e)
    expect(thrown).toMatchObject({ code: 'atomic_persist_failed', committed: false })
    // 第二批一行都没进去；第一批一个字节都没被改。
    expect(db.tables.geo_batches).toHaveLength(before.b)
    expect(db.tables.geo_observations).toHaveLength(before.o)
    expect(db.tables.geo_evidence).toHaveLength(before.e)
  })
})

describe('落库后对账必须拿**读回来的行**比，不是拿内存里的输入自己比自己', () => {
  it('RPC 说成功、批次行却读不回来 ⇒ batch_row_missing（纵深验证真的会响）', async () => {
    const db = new FakeSupabase()
    const store = new GeoSupabaseStore({ client: db as unknown as SupabaseClient, now: () => 't' })
    void store
    // RPC 提交后把批次行抽掉，模拟「库说写了、读回来没有」这种异常。
    const originalRpc = db.rpc.bind(db)
    db.rpc = async (name, params) => {
      const r = await originalRpc(name, params)
      db.tables.geo_batches.length = 0
      return r
    }
    const thrown = await runGeoMeasurementBatch(plan(), deps(db)).catch((e: unknown) => e)
    expect(thrown).toMatchObject({ code: 'batch_row_missing', committed: true })
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
    expect(thrown).toMatchObject({ code: 'coverage_success_count_mismatch', committed: true })
  })

  it('对账阶段读失败 ⇒ committed 必须是 true（此时 RPC 已经原子提交成功）', async () => {
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
    expect(thrown).toMatchObject({ code: 'query_failed', committed: true })
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
