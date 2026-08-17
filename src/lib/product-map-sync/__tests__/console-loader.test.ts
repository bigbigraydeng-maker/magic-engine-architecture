/** 载入四态 —— 最容易写错、最没人测的那段(子牙 M7)。用现成 fake-store 跑真路径。 */

import { describe, expect, it } from 'vitest'
import { FakeSyncStore } from '../fake-store'
import { loadProductMapConsole } from '../console-loader'
import type { PrFactRow } from '../types'

const NOW = new Date('2026-08-15T12:00:00Z')

function prRow(number: number): PrFactRow {
  return {
    pr_number: number,
    state: 'merged',
    is_draft: false,
    base_ref: 'main',
    head_sha: `sha-${number}`,
    merged_commit_sha: `m-${number}`,
    mergeable_state: 'clean',
    unresolved_threads: 0,
    checks: { sha: `sha-${number}`, checks: [], truncated: false },
    changed_files: [],
    changed_files_truncated: false,
    title: `PR ${number}`,
    observed_at: '2026-08-15T09:00:00Z',
    sync_run_id: 'run-1',
    human_summary: null,
    human_summary_generated_at: null,
  }
}

/** 判据是「有没有跑过轮」,所以有数据的用例必须同时有 run 行。 */
function fullRun(overrides: Partial<Parameters<typeof Object.assign>[0]> = {}) {
  return {
    id: 'run-full',
    trigger: 'cron' as const,
    mode: 'full' as const,
    status: 'ok' as const,
    main_head_sha: 'abc',
    started_at: '2026-08-15T09:00:00Z',
    finished_at: '2026-08-15T09:01:00Z',
    stats: { prsSynced: 1, issuesSynced: 0, unclassifiedSeen: 0, failedItems: [], skippedStale: 0, truncations: [] },
    error_message: null,
    ...overrides,
  }
}

describe('loadProductMapConsole 四态', () => {
  it('表未 apply → not_provisioned,且仍能出登记册视图(降级不空白)', async () => {
    const store = new FakeSyncStore()
    store.notProvisioned = true
    const p = await loadProductMapConsole(store, NOW)
    expect(p.trust.loadOutcome).toBe('not_provisioned')
    expect(p.trust.verdict).toContain('同步还没开通')
    expect(p.totalComponents).toBeGreaterThanOrEqual(20)
  })

  it('表在但零行 → never_synced(不许显示成「同步结果为空」)', async () => {
    const p = await loadProductMapConsole(new FakeSyncStore(), NOW)
    expect(p.trust.loadOutcome).toBe('never_synced')
    expect(p.trust.verdict).toContain('一次都没跑过')
  })

  it('读库炸了 → sync_error,错误摘要带出去且被截断,不吞', async () => {
    const store = new FakeSyncStore()
    store.readPrFacts = async () => {
      throw new Error('x'.repeat(500))
    }
    const p = await loadProductMapConsole(store, NOW)
    expect(p.trust.loadOutcome).toBe('sync_error')
    expect(p.trust.verdict).toContain('同步出错')
    expect(p.trust.detail.length).toBeLessThan(260)
  })

  it('快照读取真的炸了(非 NotProvisionedError)→ 降级 sync_error,不把整页崩掉(魏征实施后复审必改)', async () => {
    const store = new FakeSyncStore()
    // 主路径(PR/issue facts)正常有数据 —— 唯一的问题只在快照读取,
    // 隔离出"快照单独炸了"这一种场景,不跟"从没同步过"混在一起。
    store.prFacts.set(863, prRow(863))
    store.runs.push(fullRun())
    store.readProgressSnapshots = async () => {
      throw new Error('网络抖动')
    }
    // 断言不 throw:魏征挑出的原 bug 是这里会把异常甩到函数外面,page.tsx 没有兜底会崩页面
    const p = await loadProductMapConsole(store, NOW)
    expect(p.trust.loadOutcome).toBe('sync_error')
  })

  it('快照表未 apply(NotProvisionedError)→ 仍是 ok,只是趋势图没数据,不拖累整页', async () => {
    const store = new FakeSyncStore()
    store.readProgressSnapshots = async () => {
      throw new (await import('../types')).NotProvisionedError('fake: 快照表未 apply')
    }
    store.prFacts.set(863, prRow(863))
    store.runs.push(fullRun())
    const p = await loadProductMapConsole(store, NOW)
    expect(p.trust.loadOutcome).toBe('ok')
    expect(p.progressTrend.hasEnoughData).toBe(false)
  })

  it('有数据 → ok,PR 事实进快照并影响成熟度推导', async () => {
    const store = new FakeSyncStore()
    store.prFacts.set(863, prRow(863))
    store.runs.push(fullRun())
    const p = await loadProductMapConsole(store, NOW)
    expect(p.trust.loadOutcome).toBe('ok')
    const kernel = p.components.find((c) => c.name.includes('执行内核'))
    expect(kernel?.linkedPrs.find((pr) => pr.number === 863)?.stateLabel).toBe('已合并')
  })

  it('跑过一轮但零 PR ≠ 从没同步过(判据看 run,不看行数)', async () => {
    const store = new FakeSyncStore()
    store.runs.push(fullRun({ stats: { prsSynced: 0, issuesSynced: 0, unclassifiedSeen: 0, failedItems: [], skippedStale: 0, truncations: [] } }))
    const p = await loadProductMapConsole(store, NOW)
    expect(p.trust.loadOutcome).toBe('ok')
  })

  it('只跑过 targeted 轮 → 不冒充「刚全量核对过」', async () => {
    const store = new FakeSyncStore()
    store.prFacts.set(863, prRow(863))
    store.runs.push({
      id: 'r1',
      trigger: 'webhook',
      mode: 'targeted',
      status: 'ok',
      main_head_sha: null,
      started_at: '2026-08-15T11:00:00Z',
      finished_at: '2026-08-15T11:00:05Z',
      stats: { prsSynced: 1, issuesSynced: 0, unclassifiedSeen: 0, failedItems: [], skippedStale: 0, truncations: [] },
      error_message: null,
    })
    const p = await loadProductMapConsole(store, NOW)
    expect(p.trust.health).toBe('unknown')
    expect(p.trust.verdict).toContain('还没做过完整核对')
  })

  it('未分类工作被带出来(供总览折叠显示)', async () => {
    const store = new FakeSyncStore()
    store.prFacts.set(863, prRow(863))
    store.unclassified.set('issue#5000', {
      kind: 'issue',
      number: 5000,
      title: '野 issue',
      url: 'https://example.test/5000',
      opened_at: '2026-08-01T00:00:00Z',
      first_seen_at: '2026-08-14T00:00:00Z',
      last_seen_at: '2026-08-15T00:00:00Z',
      resolved_at: null,
    })
    const p = await loadProductMapConsole(store, NOW)
    expect(p.unclassified.map((u) => u.number)).toContain(5000)
  })
})
