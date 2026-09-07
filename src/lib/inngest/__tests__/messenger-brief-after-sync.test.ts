/**
 * 私信同步跑完 → 写客户需求卡：这个 Inngest 消费者的装配测试。
 *
 * 测的是**装配**不是纯逻辑：触发器 / 命名空间 / 副作用有没有全在 step 里 /
 * 分段有没有真分 / 顺序对不对 / 读失败会不会被伪装成「今天没人要写卡」。
 *
 * 🔴 每一条都对着这次事故的某个具体形态：
 *    · 一段跑太久 → 网关 125 秒掐断 → 分段测试
 *    · 下游步骤的问题被误报成上游没跑 → 读失败要如实报
 *    · 副作用写在 step 外 → 重放时插出假的运行记录
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const startCronRunId = vi.fn(async (_jobName: string) => 'run-1' as string | null)
const finish = vi.fn(async (_opts: Record<string, unknown>) => {})
vi.mock('@/lib/cron/run-logger', () => ({
  startCronRunId: (jobName: string) => startCronRunId(jobName),
  cronRunHandle: () => ({ finish }),
  startCronRun: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

import { createMessengerBriefAfterSyncFunction } from '../functions/messenger-brief-after-sync'
import { cloudFunctions } from '../functions'
import { CLOUD_FN_PREFIX, WORKER_OWNED_EVENTS } from '../client'
import {
  MESSENGER_BRIEF_JOB,
  MESSENGER_SYNC_COMPLETED_EVENT,
} from '@/lib/messenger/sync-completed-event'
import { BRIEFS_PER_CHUNK, type DueBrief } from '@/lib/messenger/brief-cycle'

type Fn = ReturnType<typeof createMessengerBriefAfterSyncFunction>

function optsOf(fn: Fn) {
  return (fn as unknown as {
    opts: {
      triggers?: { event?: string; cron?: string }[]
      retries?: number
      concurrency?: { limit: number; key?: string }
    }
  }).opts
}

/**
 * 假 step：`run` 直接执行并记下 id，同时记录「这次调用发生在不在某个 step 之内」——
 * 真实 Inngest 会在每个 step 边界之后重放函数体，step 外的副作用会被跑很多次。
 */
function fakeStep() {
  const ranStepIds: string[] = []
  let depth = 0
  return {
    ranStepIds,
    isInsideStep: () => depth > 0,
    step: {
      run: async (id: string, fn: () => Promise<unknown>) => {
        ranStepIds.push(id)
        depth++
        try {
          return await fn()
        } finally {
          depth--
        }
      },
    },
  }
}

function due(n: number): DueBrief[] {
  return Array.from({ length: n }, (_, i) => ({
    conversationId: `conv-${i}`,
    clientId: 'c0000000-0000-0000-0000-000000000000',
    messageCount: 3,
    lastMessageAt: '2026-09-07T20:00:00.000Z',
    existingBriefMessageCount: null,
    regenCount: 0,
    regenCountDate: null,
    awaitingReply: true,
  }))
}

const RECEIPT = {
  clients: 5,
  conversations: 3,
  messages: 7,
  new_contacts: 1,
  failed: 0,
  mailbox_error: null,
  completed_at: '2026-09-07T21:12:31.000Z',
}

interface RunOverrides {
  loadDue?: (now: Date) => Promise<DueBrief[]>
  generate?: (d: readonly DueBrief[], now: Date) => Promise<{ generated: number; failed: number }>
  sweeps?: (now: Date) => Promise<never>
  eventData?: unknown
}

async function run(over: RunOverrides = {}) {
  const seenChunks: DueBrief[][] = []
  const seenNow: number[] = []
  const harness = fakeStep()
  /** 每次写运行记录时，当时在不在 step 里 —— 这是「副作用没漏在 step 外」的直接证据。 */
  const finishInsideStep: boolean[] = []
  finish.mockImplementation(async () => {
    finishInsideStep.push(harness.isInsideStep())
  })

  const sweeps = vi.fn(async (now: Date) => {
    seenNow.push(now.getTime())
    return { qualifiedBuyers: { examined: 0 }, stageInfer: { candidates: 0 } } as never
  })
  const generate = over.generate
    ? vi.fn(over.generate)
    : vi.fn(async (d: readonly DueBrief[], now: Date) => {
        seenChunks.push([...d])
        seenNow.push(now.getTime())
        return { generated: d.length, failed: 0 }
      })

  const fn = createMessengerBriefAfterSyncFunction({
    loadDue: over.loadDue ?? (async () => due(0)),
    generate,
    sweeps: over.sweeps ?? sweeps,
  })

  const result = (await (fn as unknown as { fn: (a: unknown) => Promise<unknown> }).fn({
    event: { data: over.eventData ?? RECEIPT },
    step: harness.step,
  })) as Record<string, unknown>

  return { result, harness, seenChunks, seenNow, generate, sweeps, finishInsideStep }
}

beforeEach(() => {
  vi.clearAllMocks()
  startCronRunId.mockResolvedValue('run-1')
})

describe('注册与契约', () => {
  it('注册进了 cloudFunctions，id 带 cloud- 前缀', () => {
    expect(cloudFunctions.map((f) => f.id())).toContain(
      `${CLOUD_FN_PREFIX}messenger-brief-after-sync`,
    )
  })

  it('🔴 不监听本机 worker 已消费的事件（一事件一主，防两处各跑一遍）', () => {
    expect(WORKER_OWNED_EVENTS as readonly string[]).not.toContain(MESSENGER_SYNC_COMPLETED_EVENT)
  })

  it('触发器是「同步跑完了」那张条子，不是定时器', () => {
    const fn = cloudFunctions.find((f) => f.id().endsWith('messenger-brief-after-sync'))!
    const triggers = optsOf(fn as unknown as Fn).triggers ?? []
    expect(triggers[0]?.event).toBe(MESSENGER_SYNC_COMPLETED_EVENT)
    expect(triggers[0]?.cron).toBeUndefined()
  })

  it('同时只跑一轮 —— 两轮并行会挑出同一批候选，把同一批卡各写一遍', () => {
    const fn = cloudFunctions.find((f) => f.id().endsWith('messenger-brief-after-sync'))!
    expect(optsOf(fn as unknown as Fn).concurrency).toMatchObject({ limit: 1 })
  })

  it('🔴 retries 不许是 0 —— 收尾那一步抖一下就会让运行记录永远停在「在跑」', () => {
    // 子牙复审 2026-09-07：`retries` 是「所有 step 的最大重试次数」（不是「整条重试次数」）。
    // 写 0 = 任何一段抛错整条 run 判死，`log-finish` 那个 Supabase update 也零重试 ——
    // 那行 cron_run_logs 就永远 status='running'，而这条链路全靠那些记录是真的。
    const fn = cloudFunctions.find((f) => f.id().endsWith('messenger-brief-after-sync'))!
    const retries = optsOf(fn as unknown as Fn).retries
    expect(retries, 'retries 是 0 = 一段挂了后面全不跑，运行记录永远停在「在跑」').not.toBe(0)
    expect(retries).toBeGreaterThanOrEqual(1)
  })
})

describe('分段跑（网关约 125 秒会掐断，一段不许跑太久）', () => {
  it('🔴 一段最多 BRIEFS_PER_CHUNK 张卡，段数按这个切', async () => {
    const total = BRIEFS_PER_CHUNK * 2 + 3
    const { seenChunks, result } = await run({ loadDue: async () => due(total) })

    expect(seenChunks.map((c) => c.length)).toEqual([BRIEFS_PER_CHUNK, BRIEFS_PER_CHUNK, 3])
    expect(result.chunks).toBe(3)
    expect(result.generated).toBe(total)
  })

  it('🔴 每一段是独立的 step —— 只有分了 step，Inngest 才会一段一个请求地跑', async () => {
    const { harness } = await run({ loadDue: async () => due(BRIEFS_PER_CHUNK + 1) })
    const writeSteps = harness.ranStepIds.filter((id) => id.startsWith('write-briefs-'))
    expect(writeSteps).toEqual(['write-briefs-0', 'write-briefs-1'])
  })

  it('🔴 每张卡不许被写两遍 —— 会话 id 在所有段里合起来不重复', async () => {
    const { seenChunks } = await run({ loadDue: async () => due(BRIEFS_PER_CHUNK * 3) })
    const ids = seenChunks.flat().map((d) => d.conversationId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('🔴 段大小必须留足余量：按实测每张约 3.2 秒，一段要远在 125 秒那条线以内', () => {
    // 2026-08-22 那批运行：50 张卡 157~208 秒 → 每张约 3.2 秒。
    // 这条测试锁的是「别有人把 BRIEFS_PER_CHUNK 调回 40/50」——那就是直接踩回事故。
    expect(BRIEFS_PER_CHUNK * 3.2).toBeLessThan(80)
  })
})

describe('顺序与时刻', () => {
  it('🔴 写完卡才扫标签和阶段 —— 那两遍要读刚写好的卡', async () => {
    const { harness } = await run({ loadDue: async () => due(BRIEFS_PER_CHUNK + 1) })
    const lastWrite = harness.ranStepIds.lastIndexOf('write-briefs-1')
    const sweep = harness.ranStepIds.indexOf('post-brief-sweeps')
    expect(lastWrite).toBeGreaterThanOrEqual(0)
    expect(sweep).toBeGreaterThan(lastWrite)
  })

  it('🔴 所有段共用同一个 now —— 每段各取各的会让前后段用不同的「今天」', async () => {
    // 「安静 30 分钟才写卡」和「每条对话每天最多重写 3 次」两条闸都按 now 判。
    const { seenNow } = await run({ loadDue: async () => due(BRIEFS_PER_CHUNK * 2) })
    expect(seenNow.length).toBeGreaterThan(1)
    expect(new Set(seenNow).size).toBe(1)
  })

  it('🔴 每一次写运行记录都发生在某个 step 之内（step 外会被重放成假记录）', async () => {
    const { finishInsideStep } = await run({ loadDue: async () => due(3) })
    expect(finishInsideStep.length).toBeGreaterThan(0)
    expect(finishInsideStep.every(Boolean)).toBe(true)
  })

  it('运行记录写的是 messenger-brief-hourly —— 清单按这个名字认它', async () => {
    await run({ loadDue: async () => due(1) })
    expect(startCronRunId).toHaveBeenCalledWith(MESSENGER_BRIEF_JOB)
  })
})

describe('出问题的时候不许装作正常', () => {
  it('🔴 挑人读库失败 → 如实报失败，而且一张卡都不写', async () => {
    const { result, generate } = await run({
      loadDue: async () => {
        throw new Error('connection reset')
      },
    })
    expect(result.status).toBe('load_failed')
    expect(result.error).toBe('connection reset')
    expect(generate).not.toHaveBeenCalled()
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ failed: 1, error: 'connection reset' }))
  })

  it('🔴 读库失败不许被写成「今天没人要写卡」', async () => {
    const { result } = await run({
      loadDue: async () => {
        throw new Error('boom')
      },
    })
    expect(result.status).not.toBe('nothing_due')
  })

  it('条子读不懂 → 记一笔失败，不写卡', async () => {
    const { result, generate } = await run({ eventData: { clients: 'five' } })
    expect(result.status).toBe('invalid_payload')
    expect(generate).not.toHaveBeenCalled()
  })

  it('单段里有写失败的卡，失败数如实累加进运行记录', async () => {
    const { result } = await run({
      loadDue: async () => due(2),
      generate: async () => ({ generated: 1, failed: 1 }),
    })
    expect(result).toMatchObject({ generated: 1, failed: 1, status: 'written' })
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ completed: 1, failed: 1 }))
  })
})

describe('没人要写卡的那一轮', () => {
  it('一段都不跑，但标签和阶段那两遍照扫（跟改造之前一致）', async () => {
    const { result, generate, sweeps, harness } = await run({ loadDue: async () => due(0) })
    expect(result.status).toBe('nothing_due')
    expect(result.chunks).toBe(0)
    expect(generate).not.toHaveBeenCalled()
    expect(sweeps).toHaveBeenCalledTimes(1)
    expect(harness.ranStepIds).toContain('post-brief-sweeps')
  })

  it('照样写一行运行记录 —— 没记录会被健康检查当成「这个任务没跑」', async () => {
    await run({ loadDue: async () => due(0) })
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({ processed: 0, completed: 0, failed: 0 }),
    )
  })
})
