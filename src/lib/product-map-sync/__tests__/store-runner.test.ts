/**
 * fake store 语义(幂等/单调守卫/收编显式确认)+ runner 行为(LKG/partial/error)。
 * fake store 按表建模且逐条对齐 RPC 的 SQL 语义 —— 这里的断言同时是 SQL 的
 * 行为规约(sql-contract.test 另做文本钉扎)。
 */

import { describe, expect, it } from 'vitest'
import { FakeGithubProvider, makePrFact } from '../fake-provider'
import { FakeSyncStore } from '../fake-store'
import { runFullSync, runTargetedSync } from '../runner'
import { NotProvisionedError } from '../types'

function deps(provider: FakeGithubProvider, store: FakeSyncStore) {
  let n = 0
  return {
    provider,
    store,
    newRunId: () => `run-${++n}-${Math.abs(Date.now() % 100000)}`,
    now: () => new Date().toISOString(),
  }
}

function seededProvider(): FakeGithubProvider {
  const p = new FakeGithubProvider()
  for (const n of [863, 890, 894, 895, 897, 898, 907, 914, 922, 956, 962, 973]) {
    p.prs.set(n, makePrFact({ number: n, state: n === 962 || n === 973 || n === 907 ? 'open' : 'merged', mergedCommitSha: null }))
  }
  for (const n of [859, 870, 872, 873, 874, 875, 876, 877, 878, 879, 880, 881, 882, 883, 917, 930, 932]) {
    p.issues.set(n, {
      number: n,
      state: 'open',
      title: `Issue ${n}`,
      body: '',
      updatedAt: '2026-08-15T00:00:00Z',
      observedAt: '2026-08-15T00:00:00Z',
    })
  }
  return p
}

describe('投递幂等(claim-first,Redeliver 同 GUID)', () => {
  it('首次 claimed;processed 后重放 → duplicate', async () => {
    const store = new FakeSyncStore()
    expect(await store.claimDelivery('guid-1', 'pull_request', 'opened')).toBe('claimed')
    await store.markDelivery('guid-1', 'processed')
    expect(await store.claimDelivery('guid-1', 'pull_request', 'opened')).toBe('duplicate')
  })

  it('处理失败的投递重放 → retry_failed(允许重试,不许永久吞事件)', async () => {
    const store = new FakeSyncStore()
    await store.claimDelivery('guid-2', 'issues', null)
    await store.markDelivery('guid-2', 'failed', 'boom')
    expect(await store.claimDelivery('guid-2', 'issues', null)).toBe('retry_failed')
  })

  it('表未 apply → NotProvisionedError(不吞成功也不报假错)', async () => {
    const store = new FakeSyncStore()
    store.notProvisioned = true
    await expect(store.claimDelivery('guid-3', 'push', null)).rejects.toBeInstanceOf(
      NotProvisionedError,
    )
  })
})

describe('单调守卫与合并语义(与 SQL 逐条同步)', () => {
  it('observed_at 更旧的写入被跳过并计数,且 skippedStale 回写 run.stats', async () => {
    const store = new FakeSyncStore()
    const provider = new FakeGithubProvider()
    provider.prs.set(863, makePrFact({ number: 863, state: 'merged', observedAt: '2026-08-15T10:00:00Z' }))
    await runTargetedSync(deps(provider, store), { kind: 'pr', number: 863 })
    expect(store.prFacts.get(863)?.state).toBe('merged')

    provider.prs.set(863, makePrFact({ number: 863, state: 'open', observedAt: '2026-08-15T09:00:00Z' }))
    const result = await runTargetedSync(deps(provider, store), { kind: 'pr', number: 863 })
    expect(store.prFacts.get(863)?.state).toBe('merged')
    expect(result?.stats.skippedStale).toBe(1)
    // 台账里的 run.stats 也必须是真值,不许只有返回值是真的
    expect(store.runs[store.runs.length - 1].stats.skippedStale).toBe(1)
  })

  it("mergeable 'unknown' 不覆盖已知值;threads null 留旧值", async () => {
    const store = new FakeSyncStore()
    const provider = new FakeGithubProvider()
    provider.prs.set(863, makePrFact({ number: 863, mergeableState: 'clean', unresolvedThreads: 2, observedAt: '2026-08-15T08:00:00Z' }))
    await runTargetedSync(deps(provider, store), { kind: 'pr', number: 863 })

    provider.prs.set(863, makePrFact({ number: 863, mergeableState: 'unknown', unresolvedThreads: null, observedAt: '2026-08-15T09:00:00Z' }))
    await runTargetedSync(deps(provider, store), { kind: 'pr', number: 863 })
    const row = store.prFacts.get(863)
    expect(row?.mergeable_state).toBe('clean')
    expect(row?.unresolved_threads).toBe(2)
  })
})

describe('runFullSync', () => {
  it('全量成功 → ok,facts 落表,checks 与 head sha 键控绑定', async () => {
    const store = new FakeSyncStore()
    const result = await runFullSync(deps(seededProvider(), store), 'cron')
    expect(result.status).toBe('ok')
    expect(store.prFacts.size).toBeGreaterThan(0)
    expect(store.issueFacts.size).toBeGreaterThan(0)
    const row = store.prFacts.get(863)
    expect(row?.checks.sha).toBe(row?.head_sha)
  })

  it('单条抓取失败 → partial + 旧行原样保留(last-known-good)', async () => {
    const store = new FakeSyncStore()
    await runFullSync(deps(seededProvider(), store), 'cron')
    const before = store.prFacts.get(962)
    expect(before).toBeDefined()

    const p2 = seededProvider()
    p2.failNumbers.add(962)
    const result = await runFullSync(deps(p2, store), 'cron')
    expect(result.status).toBe('partial')
    expect(result.stats.failedItems.some((f) => f.includes('962'))).toBe(true)
    expect(store.prFacts.get(962)).toEqual(before)
  })

  it('限流中途打爆 → partial,已抓到的照常落库、没轮到的留旧行(成果不丢)', async () => {
    const store = new FakeSyncStore()
    const p = seededProvider()
    p.rateLimitAfter = 3
    const result = await runFullSync(deps(p, store), 'cron')
    expect(result.status).toBe('partial')
    // 已抓到的 3 个真的进了表
    expect(result.stats.prsSynced).toBe(3)
    expect(store.prFacts.size).toBe(3)
    // 没轮到的号码进 failedItems,标明「未尝试」
    expect(result.stats.failedItems.some((f) => f.includes('未尝试'))).toBe(true)
  })

  it('已 merged 且有 merged_commit_sha 的 PR 不重抓(省限流配额)', async () => {
    const store = new FakeSyncStore()
    const p1 = seededProvider()
    p1.prs.set(863, makePrFact({ number: 863, state: 'merged', mergedCommitSha: 'abc', observedAt: '2026-08-15T01:00:00Z' }))
    await runFullSync(deps(p1, store), 'cron')

    const p2 = seededProvider()
    p2.prs.set(863, makePrFact({ number: 863, state: 'open', observedAt: '2026-08-16T00:00:00Z' }))
    await runFullSync(deps(p2, store), 'cron')
    expect(store.prFacts.get(863)?.state).toBe('merged')
  })

  it('provider 整体炸掉(非限流)→ error run 落台账,原始错误在 stats 里可见', async () => {
    const store = new FakeSyncStore()
    const p = seededProvider()
    p.mainHeadError = new Error('boom')
    const result = await runFullSync(deps(p, store), 'cron')
    expect(result.status).toBe('error')
    expect(result.stats.failedItems.some((f) => f.includes('boom'))).toBe(true)
    expect(store.runs[store.runs.length - 1].status).toBe('error')
    expect(store.prFacts.size).toBe(0)
  })

  it('表未 apply → NotProvisionedError 原样上抛(route 层要区分「待 provision」和「坏了」)', async () => {
    const store = new FakeSyncStore()
    store.notProvisioned = true
    await expect(runFullSync(deps(seededProvider(), store), 'cron')).rejects.toBeInstanceOf(
      NotProvisionedError,
    )
  })

  it('webhook error 汇总窗口 = 上一次 full 轮以来,且只数 webhook 触发的', async () => {
    const store = new FakeSyncStore()
    await runFullSync(deps(seededProvider(), store), 'cron')
    // 一个 webhook error run + 一个非 webhook error(不该被计入)
    const p = seededProvider()
    p.prs.delete(962)
    p.failNumbers.add(962)
    const d = deps(p, store)
    // 手工塞一条 webhook error run
    await store.commitSync({
      run: {
        id: 'wh-err', trigger: 'webhook', mode: 'targeted', status: 'error',
        main_head_sha: null, started_at: d.now(), finished_at: d.now(),
        stats: { prsSynced: 0, issuesSynced: 0, unclassifiedSeen: 0, failedItems: [], skippedStale: 0, truncations: [] },
        error_message: 'x',
      },
      prFacts: [], issueFacts: [], unclassified: [], resolve: [], mode: 'targeted',
    })
    const result = await runFullSync(deps(seededProvider(), store), 'cron')
    expect(result.stats.webhookErrorRunsSinceLastFull).toBe(1)
  })
})

describe('未分类队列:发现不许死在台账里', () => {
  it('未分类工作进队列;partial 轮绝不整锅收编', async () => {
    const store = new FakeSyncStore()
    const p1 = seededProvider()
    p1.recentWork = [
      { kind: 'issue', number: 5000, title: '野 issue', body: 'no marker', url: 'u', openedAt: '2026-08-14T00:00:00Z' },
    ]
    await runFullSync(deps(p1, store), 'cron')
    expect((await store.readUnclassified()).map((r) => r.number)).toContain(5000)

    // 下一轮限流打爆(扫描没跑全)—— 队列必须原样保留
    const p2 = seededProvider()
    p2.rateLimitAfter = 0
    await runFullSync(deps(p2, store), 'cron')
    expect((await store.readUnclassified()).map((r) => r.number)).toContain(5000)
  })

  it('收编 = 显式确认制:复核确认 closed 才消;30 天没动静的 open item 留在队列', async () => {
    const store = new FakeSyncStore()
    const p1 = seededProvider()
    p1.recentWork = [
      { kind: 'issue', number: 5000, title: '已关闭的', body: '', url: 'u', openedAt: '2026-08-01T00:00:00Z' },
      { kind: 'issue', number: 5001, title: '陈年 open', body: '', url: 'u', openedAt: '2026-07-01T00:00:00Z' },
    ]
    await runFullSync(deps(p1, store), 'cron')

    // 下一轮:两条都掉出扫描窗口;复核显示 5000 已 closed、5001 仍 open
    const p2 = seededProvider()
    p2.recentWork = []
    p2.workItemStates.set(5000, { number: 5000, state: 'closed', body: '' })
    p2.workItemStates.set(5001, { number: 5001, state: 'open', body: '' })
    await runFullSync(deps(p2, store), 'cron')
    const remaining = (await store.readUnclassified()).map((r) => r.number)
    expect(remaining).not.toContain(5000)
    expect(remaining).toContain(5001)
  })

  it('补了合法标记(\\r\\n body)的存量行被收编', async () => {
    const store = new FakeSyncStore()
    const p1 = seededProvider()
    p1.recentWork = [
      { kind: 'issue', number: 5002, title: '后补标记', body: '', url: 'u', openedAt: '2026-08-01T00:00:00Z' },
    ]
    await runFullSync(deps(p1, store), 'cron')

    const p2 = seededProvider()
    p2.recentWork = []
    p2.workItemStates.set(5002, {
      number: 5002,
      state: 'open',
      body: '补:\r\nME2-Component-ID: platform.execution-kernel\r\n',
    })
    await runFullSync(deps(p2, store), 'cron')
    expect((await store.readUnclassified()).map((r) => r.number)).not.toContain(5002)
  })

  it('store 层:targeted 轮哪怕带了 resolve 名单也不生效(收编只属于 full)', async () => {
    const store = new FakeSyncStore()
    const p1 = seededProvider()
    p1.recentWork = [
      { kind: 'issue', number: 5009, title: 'x', body: '', url: 'u', openedAt: '2026-08-01T00:00:00Z' },
    ]
    await runFullSync(deps(p1, store), 'cron')

    await store.commitSync({
      run: {
        id: 'targeted-x', trigger: 'webhook', mode: 'targeted', status: 'ok',
        main_head_sha: null, started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
        stats: { prsSynced: 0, issuesSynced: 0, unclassifiedSeen: 0, failedItems: [], skippedStale: 0, truncations: [] },
        error_message: null,
      },
      prFacts: [], issueFacts: [], unclassified: [],
      resolve: [{ kind: 'issue', number: 5009 }],
      mode: 'targeted',
    })
    expect((await store.readUnclassified()).map((r) => r.number)).toContain(5009)
  })

  it('复核本身被限流 → 本轮不收编(不误消)', async () => {
    const store = new FakeSyncStore()
    const p1 = seededProvider()
    p1.recentWork = [
      { kind: 'issue', number: 5003, title: 'x', body: '', url: 'u', openedAt: '2026-08-01T00:00:00Z' },
    ]
    await runFullSync(deps(p1, store), 'cron')

    const p2 = seededProvider()
    p2.recentWork = []
    p2.workItemStates.set(5003, { number: 5003, state: 'closed', body: '' })
    // 轮到存量复核时配额已尽 —— 哪怕真实状态是 closed 也不许在盲抓下收编
    p2.rateLimitWorkItems = true
    const result = await runFullSync(deps(p2, store), 'cron')
    expect(result.status).toBe('partial')
    expect((await store.readUnclassified()).map((r) => r.number)).toContain(5003)
  })
})

describe('runTargetedSync', () => {
  it('登记册号码 → 正常同步', async () => {
    const store = new FakeSyncStore()
    const provider = new FakeGithubProvider()
    provider.prs.set(863, makePrFact({ number: 863 }))
    const result = await runTargetedSync(deps(provider, store), { kind: 'pr', number: 863 })
    expect(result?.status).toBe('ok')
    expect(store.prFacts.has(863)).toBe(true)
  })

  it('非登记册号码 → null,不建 run 不落 facts(孤儿行会钉死快照鲜度)', async () => {
    const store = new FakeSyncStore()
    const provider = new FakeGithubProvider()
    provider.prs.set(99999, makePrFact({ number: 99999 }))
    const result = await runTargetedSync(deps(provider, store), { kind: 'pr', number: 99999 })
    expect(result).toBeNull()
    expect(store.prFacts.size).toBe(0)
    expect(store.runs).toHaveLength(0)
  })

  it('GraphQL 失败(threads null 且无旧值可留)→ partial,与 full 轮同口径', async () => {
    const store = new FakeSyncStore()
    const provider = new FakeGithubProvider()
    provider.prs.set(863, makePrFact({ number: 863, unresolvedThreads: null }))
    const result = await runTargetedSync(deps(provider, store), { kind: 'pr', number: 863 })
    expect(result?.status).toBe('partial')
  })
})
