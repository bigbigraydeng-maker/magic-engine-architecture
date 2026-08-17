/**
 * runner 新增的两个后置阶段(摘要生成 + 每日进度快照)—— 子牙 + 魏征设计审的
 * 必改项按值锁:预算耗尽、每轮硬顶、禁用词护栏、并发让步、run stats 记账。
 */

import { describe, expect, it } from 'vitest'
import { PRODUCT_MAP_COMPONENTS } from '@/lib/product-map'
import { FakeGithubProvider, makePrFact } from '../fake-provider'
import { FakeSyncStore } from '../fake-store'
import { runFullSync } from '../runner'
import type { SummaryGenerator } from '../summary-generator'
import type { IssueFactRow, PrFactRow } from '../types'

class FakeSummaryGenerator implements SummaryGenerator {
  readonly calls: { kind: 'pr' | 'issue'; title: string }[] = []
  constructor(private readonly resolver: (kind: 'pr' | 'issue', title: string) => string | null) {}
  async summarize(kind: 'pr' | 'issue', title: string): Promise<string | null> {
    this.calls.push({ kind, title })
    return this.resolver(kind, title)
  }
}

function deps(
  provider: FakeGithubProvider,
  store: FakeSyncStore,
  opts: { summarizer?: SummaryGenerator; summaryPhaseBudgetMs?: number } = {},
) {
  let n = 0
  return {
    provider,
    store,
    newRunId: () => `run-${++n}`,
    now: () => new Date().toISOString(),
    ...opts,
  }
}

/**
 * 动态从真实登记表铺满 provider(不手写号码清单)—— 否则漏掉任何一个真实号码,
 * provider 都会报"抓不到"进 failedItems,把 run 拖成 partial,这批用例只关心
 * 摘要/快照阶段,不需要真的验证抓取本身。
 */
function fullySeededProvider(): FakeGithubProvider {
  const p = new FakeGithubProvider()
  for (const c of PRODUCT_MAP_COMPONENTS) {
    for (const pr of c.linkedPullRequests) {
      if (!p.prs.has(pr.number)) {
        p.prs.set(pr.number, makePrFact({ number: pr.number, state: 'merged', mergedCommitSha: `m-${pr.number}` }))
      }
    }
    for (const n of c.linkedIssues) {
      if (!p.issues.has(n)) {
        p.issues.set(n, {
          number: n,
          state: 'open',
          title: `Issue ${n}`,
          body: '',
          updatedAt: '2026-08-15T00:00:00Z',
          observedAt: '2026-08-15T00:00:00Z',
        })
      }
    }
  }
  return p
}

function extraPrRow(number: number, overrides: Partial<PrFactRow> = {}): PrFactRow {
  return {
    pr_number: number,
    state: 'open',
    is_draft: false,
    base_ref: 'main',
    head_sha: `sha-${number}`,
    merged_commit_sha: null,
    mergeable_state: 'clean',
    unresolved_threads: 0,
    checks: { sha: `sha-${number}`, checks: [], truncated: false },
    changed_files: [],
    changed_files_truncated: false,
    title: `额外测试 PR ${number}`,
    observed_at: '2026-08-15T09:00:00Z',
    sync_run_id: 'seed',
    human_summary: null,
    human_summary_generated_at: null,
    ...overrides,
  }
}

/**
 * 把真实登记表里所有 PR/issue 都预置成"已经有摘要"—— 让候选池只剩测试自己
 * 注入的号码,断言不随注册表实际大小变化而脆(merged PR 会被 runFullSync 判
 * immutable 整条跳过抓取;issue 每轮都重抓,但 fake store 的 commitSync 对已有
 * human_summary 的行做 carry-over,不会被刷新覆盖)。
 */
function seedRegistryWithExistingSummaries(store: FakeSyncStore): void {
  for (const c of PRODUCT_MAP_COMPONENTS) {
    for (const pr of c.linkedPullRequests) {
      store.prFacts.set(
        pr.number,
        extraPrRow(pr.number, {
          state: 'merged',
          merged_commit_sha: `m-${pr.number}`,
          observed_at: '2026-08-14T00:00:00Z',
          human_summary: '已经有摘要',
          human_summary_generated_at: '2026-08-14T00:00:00Z',
        }),
      )
    }
    for (const n of c.linkedIssues) {
      store.issueFacts.set(
        n,
        extraIssueRow(n, {
          observed_at: '2026-08-14T00:00:00Z',
          human_summary: '已经有摘要',
          human_summary_generated_at: '2026-08-14T00:00:00Z',
        }),
      )
    }
  }
}

function extraIssueRow(number: number, overrides: Partial<IssueFactRow> = {}): IssueFactRow {
  return {
    issue_number: number,
    state: 'open',
    title: `额外测试 Issue ${number}`,
    updated_at: '2026-08-15T09:00:00Z',
    observed_at: '2026-08-15T09:00:00Z',
    sync_run_id: 'seed',
    human_summary: null,
    human_summary_generated_at: null,
    ...overrides,
  }
}

describe('摘要生成:未接大模型 = 整体跳过', () => {
  it('不传 summarizer → summariesGenerated 全 0,不影响同步主结果', async () => {
    const store = new FakeSyncStore()
    const result = await runFullSync(deps(fullySeededProvider(), store), 'cron')
    expect(result.status).toBe('ok')
    expect(result.stats.summariesGenerated).toBe(0)
    expect(result.stats.summariesFailed).toBe(0)
  })
})

describe('摘要生成:幂等 —— 已有摘要的行不再调用大模型', () => {
  it('第二轮同步,已生成摘要的号码不出现在 summarizer 的调用记录里', async () => {
    const store = new FakeSyncStore()
    store.prFacts.set(863, extraPrRow(863, { human_summary: '已经有摘要了', state: 'merged', merged_commit_sha: 'm-863' }))
    const gen = new FakeSummaryGenerator(() => '这条不该被调用')
    await runFullSync(deps(fullySeededProvider(), store, { summarizer: gen }), 'cron')
    expect(gen.calls.some((c) => c.title.includes('863'))).toBe(false)
  })
})

describe('摘要生成:每轮硬顶(子牙设计审「成本/频率」必改项)', () => {
  it('候选超过 25 条时只处理前 25 条,其余计入 summariesSkippedBudget', async () => {
    const store = new FakeSyncStore()
    seedRegistryWithExistingSummaries(store)
    for (let i = 1; i <= 30; i++) store.issueFacts.set(9000 + i, extraIssueRow(9000 + i))
    const gen = new FakeSummaryGenerator(() => '一句人话摘要')
    const result = await runFullSync(deps(fullySeededProvider(), store, { summarizer: gen }), 'cron')
    expect(gen.calls.length).toBe(25)
    expect(result.stats.summariesGenerated).toBe(25)
    expect(result.stats.summariesSkippedBudget).toBe(5)
  })
})

describe('摘要生成:预算耗尽提前放弃(子牙设计审「独立时间预算」必改项)', () => {
  it('预算为 0 时一条都不处理,全部留给下一轮', async () => {
    const store = new FakeSyncStore()
    seedRegistryWithExistingSummaries(store)
    for (let i = 1; i <= 3; i++) store.issueFacts.set(9100 + i, extraIssueRow(9100 + i))
    const gen = new FakeSummaryGenerator(() => '一句人话摘要')
    const result = await runFullSync(
      deps(fullySeededProvider(), store, { summarizer: gen, summaryPhaseBudgetMs: -1 }),
      'cron',
    )
    expect(gen.calls.length).toBe(0)
    expect(result.stats.summariesGenerated).toBe(0)
    expect(result.stats.summariesSkippedBudget).toBe(3)
    // 没处理的行 human_summary 仍是 null,下一轮会重新捡回来
    expect(store.issueFacts.get(9101)?.human_summary).toBeNull()
  })
})

describe('摘要生成:禁用状态词护栏(魏征设计审必改 4 —— 幻觉防线)', () => {
  it('命中黑名单的摘要不写入,计入 summariesRejected,不计入 summariesFailed', async () => {
    const store = new FakeSyncStore()
    seedRegistryWithExistingSummaries(store)
    store.issueFacts.set(9200, extraIssueRow(9200, { title: '会触发幻觉的标题' }))
    const gen = new FakeSummaryGenerator(() => '这个问题已经解决了')
    const result = await runFullSync(deps(fullySeededProvider(), store, { summarizer: gen }), 'cron')
    expect(result.stats.summariesRejected).toBe(1)
    expect(result.stats.summariesFailed).toBe(0)
    expect(store.issueFacts.get(9200)?.human_summary).toBeNull()
  })
})

describe('摘要生成:调用失败(返回 null)留 null,不阻塞主流程', () => {
  it('summarize 返回 null → summariesFailed 计数,run 仍然 ok', async () => {
    const store = new FakeSyncStore()
    seedRegistryWithExistingSummaries(store)
    store.issueFacts.set(9300, extraIssueRow(9300))
    const gen = new FakeSummaryGenerator(() => null)
    const result = await runFullSync(deps(fullySeededProvider(), store, { summarizer: gen }), 'cron')
    expect(result.status).toBe('ok')
    expect(result.stats.summariesFailed).toBe(1)
    expect(store.issueFacts.get(9300)?.human_summary).toBeNull()
  })

  it('summarizer 本身意外 throw(不遵守接口约定)也不能让整轮同步变成 error', async () => {
    const store = new FakeSyncStore()
    store.issueFacts.set(9400, extraIssueRow(9400))
    const badGen: SummaryGenerator = {
      summarize: async () => {
        throw new Error('这个实现没有按接口约定捕获异常')
      },
    }
    const result = await runFullSync(deps(fullySeededProvider(), store, { summarizer: badGen }), 'cron')
    expect(result.status).toBe('ok') // facts 已经落库,摘要阶段的异常不能倒灌回主状态
  })

  it('生成成功但落库失败 → 整批退回 failed,不假装写成功了一部分', async () => {
    const store = new FakeSyncStore()
    seedRegistryWithExistingSummaries(store)
    store.issueFacts.set(9500, extraIssueRow(9500))
    store.issueFacts.set(9501, extraIssueRow(9501))
    const gen = new FakeSummaryGenerator(() => '一句正常摘要')
    const originalWrite = store.writeSummaries.bind(store)
    store.writeSummaries = async () => {
      throw new Error('模拟网络抖动')
    }
    const result = await runFullSync(deps(fullySeededProvider(), store, { summarizer: gen }), 'cron')
    expect(result.status).toBe('ok')
    expect(result.stats.summariesGenerated).toBe(0)
    expect(result.stats.summariesFailed).toBe(2)
    store.writeSummaries = originalWrite
  })

  it('预算耗尽 + 落库失败同时发生 → skippedBudget 不能漏加(魏征实施后复审建议 2)', async () => {
    const store = new FakeSyncStore()
    seedRegistryWithExistingSummaries(store)
    // 3 条:预算为 0 时一条都不会真正被"处理"(全部落 budgetSkipped),
    // 但既然候选存在,一旦预算给够又叠加写库失败,两处计数必须加总不漏。
    store.issueFacts.set(9700, extraIssueRow(9700))
    store.issueFacts.set(9701, extraIssueRow(9701))
    store.issueFacts.set(9702, extraIssueRow(9702))
    const gen = new FakeSummaryGenerator(() => '一句正常摘要')
    store.writeSummaries = async () => {
      throw new Error('模拟网络抖动')
    }
    // 预算只够处理前 1 条(近似模拟:第 2 条开始预算耗尽),第 1 条生成成功但落库失败
    let calls = 0
    const slowGen: SummaryGenerator = {
      summarize: async (kind, title) => {
        calls++
        if (calls > 1) await new Promise((r) => setTimeout(r, 30)) // 让后续调用撞上预算
        return gen.summarize(kind, title)
      },
    }
    const result = await runFullSync(
      deps(fullySeededProvider(), store, { summarizer: slowGen, summaryPhaseBudgetMs: 20 }),
      'cron',
    )
    // 不精确断言具体切分点(时序相关),只锁住"总数不丢"这条不变式:
    // failed(落库失败退回) + skippedBudget(预算耗尽部分) 必须覆盖全部 3 条候选
    expect(result.stats.summariesGenerated).toBe(0)
    expect((result.stats.summariesFailed ?? 0) + (result.stats.summariesSkippedBudget ?? 0)).toBe(3)
  })
})

describe('每日进度快照:复用 buildPresentation 的结果,不另开推导', () => {
  it('一次 full 同步后写入今天的快照行,三堆之和 == 总组件数', async () => {
    const store = new FakeSyncStore()
    const result = await runFullSync(deps(fullySeededProvider(), store), 'cron')
    const today = new Date().toISOString().slice(0, 10)
    const snap = store.progressSnapshots.get(today)
    expect(snap).toBeDefined()
    expect(snap!.operating_count + snap!.built_not_live_count + snap!.building_count).toBe(
      snap!.total_components,
    )
    expect(snap!.sync_run_id).toBe(result.runId)
    expect(result.stats.progressSnapshotWritten).toBe(true)
  })
})

describe('每日进度快照:并发让步(魏征设计审必改项 —— 谁的结果新就留谁)', () => {
  it('更早 run_started_at 的写入不能覆盖已有的更晚快照', async () => {
    const store = new FakeSyncStore()
    const later = await store.upsertProgressSnapshot({
      snapshotDate: '2026-08-17',
      totalComponents: 25,
      operatingCount: 3,
      builtNotLiveCount: 10,
      buildingCount: 12,
      maturityCounts: {},
      syncRunId: 'run-later',
      runStartedAt: '2026-08-17T20:00:00Z',
    })
    expect(later.written).toBe(true)

    const earlier = await store.upsertProgressSnapshot({
      snapshotDate: '2026-08-17',
      totalComponents: 25,
      operatingCount: 999, // 明显不同的数字,方便断言"没有覆盖"
      builtNotLiveCount: 0,
      buildingCount: 0,
      maturityCounts: {},
      syncRunId: 'run-earlier',
      runStartedAt: '2026-08-17T08:00:00Z',
    })
    expect(earlier.written).toBe(false)
    expect(store.progressSnapshots.get('2026-08-17')?.operating_count).toBe(3) // 仍是更晚那次的值
  })

  it('同一轮重放(run_started_at 相等)允许覆盖 —— 幂等重试不被挡', async () => {
    const store = new FakeSyncStore()
    await store.upsertProgressSnapshot({
      snapshotDate: '2026-08-17',
      totalComponents: 25,
      operatingCount: 3,
      builtNotLiveCount: 10,
      buildingCount: 12,
      maturityCounts: {},
      syncRunId: 'run-x',
      runStartedAt: '2026-08-17T20:00:00Z',
    })
    const replay = await store.upsertProgressSnapshot({
      snapshotDate: '2026-08-17',
      totalComponents: 25,
      operatingCount: 4,
      builtNotLiveCount: 9,
      buildingCount: 12,
      maturityCounts: {},
      syncRunId: 'run-x',
      runStartedAt: '2026-08-17T20:00:00Z',
    })
    expect(replay.written).toBe(true)
    expect(store.progressSnapshots.get('2026-08-17')?.operating_count).toBe(4)
  })
})

describe('run stats 事后记账(子牙设计审:失败不许静默,巡检要能一眼看到)', () => {
  it('摘要 + 快照阶段的结果会 patch 进 run 行的 stats', async () => {
    const store = new FakeSyncStore()
    seedRegistryWithExistingSummaries(store)
    store.issueFacts.set(9600, extraIssueRow(9600))
    const gen = new FakeSummaryGenerator(() => '一句正常摘要')
    const result = await runFullSync(deps(fullySeededProvider(), store, { summarizer: gen }), 'cron')
    const runRow = store.runs.find((r) => r.id === result.runId)
    expect(runRow?.stats.summariesGenerated).toBe(1)
    expect(runRow?.stats.progressSnapshotWritten).toBe(true)
  })
})
