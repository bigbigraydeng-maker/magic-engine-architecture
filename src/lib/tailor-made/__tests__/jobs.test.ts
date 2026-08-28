/**
 * tailor_made_jobs 读写。钉住的几件事：
 *   1. 同一份行程、同一种任务、**同一份输入内容**还有没跑完的（queued/running），
 *      复用它，不重开——防手抖连点两次上传白白多花一次 AI 调用的钱。
 *   2. 输入内容不同的两次提交永远各建各的，不能被复用逻辑悄悄合并
 *      （Codex 复审点出来的真实场景：两个标签页对同一份行程提交不同内容，
 *      复用会让第二份输入被无声丢弃、还把第一份结果错当成第二份的）。
 *   3. 并发插入撞上数据库唯一索引（23505）时退化为复用，不能把冲突甩给调用方
 *      （子牙+魏征复审都点出「先查后插」本身挡不住并发，真正防线在 DB 唯一索引，
 *      代码必须接住冲突）。
 *   4. 卡住太久的僵尸任务（Render 重启/进程被杀留下的）不能一直挡着新任务，
 *      也不能被 createOrReuseJob 永远复用。
 *   5. completed/failed 各自写对状态、结果、时间戳，且查询报错时不能被静默吞掉
 *      ——吞掉等于让 500 变成 Next.js 默认 HTML 错误页，原样复现这次要修的故障。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

import { supabaseAdmin } from '@/lib/supabase'
import { createOrReuseJob, fingerprintInput, getJob, markCompleted, markFailed, markRunning } from '../jobs'

const FP = fingerprintInput('some-file-content')

const CLIENT = 'client-cts'
const ITINERARY = 'itin-1'

interface MockState {
  /** activeJob() 依次返回的结果（sweepStaleForKey 不查询，只更新，不占这个队列） */
  selectQueue: Array<Array<{ id: string }>>
  insertResult: { data: { id: string } | null; error: { code: string; message: string } | null }
  updates: Array<{ patch: Record<string, unknown>; eq: Array<[string, unknown]>; lt?: string }>
  /** 每次 activeJob() 的 select().eq(...) 参数，用来断言真的按 fingerprint 过滤了 */
  selectEqCalls?: Array<Array<[string, unknown]>>
}

function mockDb(state: MockState) {
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    if (table !== 'tailor_made_jobs') throw new Error(`unexpected table ${table}`)
    return {
      select: () => {
        const eqCalls: Array<[string, unknown]> = []
        const chain = {
          eq: (col: string, val: unknown) => { eqCalls.push([col, val]); return chain },
          in: () => chain,
          order: () => chain,
          limit: () => {
            ;(state.selectEqCalls ??= []).push(eqCalls)
            return Promise.resolve({ data: state.selectQueue.shift() ?? [], error: null })
          },
        }
        return chain
      },
      insert: () => ({
        select: () => ({
          single: () => Promise.resolve(state.insertResult),
        }),
      }),
      update: (patch: Record<string, unknown>) => {
        const record = { patch, eq: [] as Array<[string, unknown]>, lt: undefined as string | undefined }
        state.updates.push(record)
        const chain = {
          eq: (col: string, val: unknown) => {
            record.eq.push([col, val])
            return chain
          },
          in: () => chain,
          lt: (_col: string, val: string) => {
            record.lt = val
            return Promise.resolve({ data: null, error: null })
          },
        }
        return chain
      },
    }
  })
}

describe('createOrReuseJob', () => {
  beforeEach(() => vi.clearAllMocks())

  it('有未跑完的同类任务时直接复用，不新建', async () => {
    // 第一次 select 调用来自 createOrReuseJob 里的 activeJob()
    const state: MockState = {
      selectQueue: [[{ id: 'job-existing' }]],
      insertResult: { data: null, error: null },
      updates: [],
    }
    mockDb(state)

    const result = await createOrReuseJob({
      clientId: CLIENT,
      itineraryId: ITINERARY,
      kind: 'import_file',
      inputFingerprint: FP,
      input: { filename: 'x.pdf' },
    })

    expect(result).toEqual({ jobId: 'job-existing', reused: true })
    // sweepStaleForKey 应该先跑一次（清理这个 key 下的僵尸任务）
    expect(state.updates).toHaveLength(1)
    expect(state.updates[0].patch.status).toBe('failed')
  })

  it('没有未跑完的任务时新建一条', async () => {
    const state: MockState = {
      selectQueue: [[]], // activeJob() 查不到
      insertResult: { data: { id: 'job-new' }, error: null },
      updates: [],
    }
    mockDb(state)

    const result = await createOrReuseJob({
      clientId: CLIENT,
      itineraryId: ITINERARY,
      kind: 'extract_text',
      inputFingerprint: FP,
      input: { messageLength: 42 },
    })

    expect(result).toEqual({ jobId: 'job-new', reused: false })
  })

  it('activeJob() 真的按 input_fingerprint 过滤，不同内容各建各的', async () => {
    const state: MockState = {
      selectQueue: [[]], // 不同指纹查不到对方
      insertResult: { data: { id: 'job-for-different-input' }, error: null },
      updates: [],
    }
    mockDb(state)
    const otherFp = fingerprintInput('a-completely-different-file')

    const result = await createOrReuseJob({
      clientId: CLIENT,
      itineraryId: ITINERARY,
      kind: 'import_file',
      inputFingerprint: otherFp,
      input: { filename: 'y.pdf' },
    })

    expect(result).toEqual({ jobId: 'job-for-different-input', reused: false })
    // 断言查询真的把 fingerprint 当过滤条件传下去了，不是摆设字段
    const fingerprintFilters = state.selectEqCalls?.flat().filter(([col]) => col === 'input_fingerprint')
    expect(fingerprintFilters).toEqual([['input_fingerprint', otherFp]])
  })

  it('插入撞上唯一索引冲突（23505）时退化为复用，不抛错', async () => {
    const state: MockState = {
      // 第一次 activeJob() 查不到（两个并发请求都以为没有活跃任务）；
      // insert 撞冲突后第二次 activeJob() 查到并发请求刚建成的那条
      selectQueue: [[], [{ id: 'job-won-the-race' }]],
      insertResult: { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } },
      updates: [],
    }
    mockDb(state)

    const result = await createOrReuseJob({
      clientId: CLIENT,
      itineraryId: ITINERARY,
      kind: 'import_file',
      inputFingerprint: FP,
      input: { filename: 'x.pdf' },
    })

    expect(result).toEqual({ jobId: 'job-won-the-race', reused: true })
  })

  it('插入报其他错误（非 23505）时照常抛错，不能悄悄吞掉', async () => {
    const state: MockState = {
      selectQueue: [[]],
      insertResult: { data: null, error: { code: '42P01', message: 'relation "tailor_made_jobs" does not exist' } },
      updates: [],
    }
    mockDb(state)

    await expect(
      createOrReuseJob({ clientId: CLIENT, itineraryId: ITINERARY, kind: 'import_file', inputFingerprint: FP, input: {} })
    ).rejects.toThrow(/建任务失败/)
  })
})

describe('getJob', () => {
  beforeEach(() => vi.clearAllMocks())

  it('查到僵尸任务（running 且早就过了 stale 期限）时纠正成 failed 再返回', async () => {
    const staleRow = {
      id: 'job-1',
      client_id: CLIENT,
      itinerary_id: ITINERARY,
      kind: 'import_file',
      status: 'running',
      input: {},
      result: null,
      error: null,
      created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(), // 20 分钟前，早过 10 分钟阈值
      completed_at: null,
    }
    const updates: Array<Record<string, unknown>> = []
    ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: staleRow, error: null }) }),
        }),
      }),
      update: (patch: Record<string, unknown>) => {
        updates.push(patch)
        return { eq: () => Promise.resolve({ data: null, error: null }) }
      },
    }))

    const result = await getJob(CLIENT, 'job-1')
    expect(result?.status).toBe('failed')
    expect(updates).toHaveLength(1)
    expect(updates[0].status).toBe('failed')
  })

  it('查询本身报错时抛出，不能静默返回空', async () => {
    ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: 'db down' } }) }),
        }),
      }),
    }))

    await expect(getJob(CLIENT, 'job-x')).rejects.toThrow(/读取任务失败/)
  })
})

describe('markRunning / markCompleted / markFailed', () => {
  beforeEach(() => vi.clearAllMocks())

  /** errorQueue 依次作为每次 .eq() 落地的结果；用完了默认成功。 */
  function mockUpdateOnly(
    updates: Array<{ patch: Record<string, unknown>; eq: Array<[string, unknown]> }>,
    errorQueue: Array<{ message: string } | null> = []
  ) {
    ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      update: (patch: Record<string, unknown>) => {
        const eqCalls: Array<[string, unknown]> = []
        const chain = {
          eq: (col: string, val: unknown) => {
            eqCalls.push([col, val])
            updates.push({ patch, eq: eqCalls })
            const error = errorQueue.length > 0 ? errorQueue.shift()! : null
            return Promise.resolve({ data: null, error })
          },
        }
        return chain
      },
    }))
  }

  it('markCompleted 写 completed 状态、结果与完成时间', async () => {
    const updates: Array<{ patch: Record<string, unknown>; eq: Array<[string, unknown]> }> = []
    mockUpdateOnly(updates)

    await markCompleted('job-1', { payload: { days: [] }, review: [], reply: 'ok' })

    expect(updates[0].patch.status).toBe('completed')
    expect(updates[0].patch.result).toEqual({ payload: { days: [] }, review: [], reply: 'ok' })
    expect(updates[0].patch.completed_at).toEqual(expect.any(String))
    expect(updates[0].eq).toEqual([['id', 'job-1']])
  })

  it('markCompleted 第一次写库失败时重试一次，重试成功就不丢结果', async () => {
    const updates: Array<{ patch: Record<string, unknown>; eq: Array<[string, unknown]> }> = []
    mockUpdateOnly(updates, [{ message: 'db hiccup' }, null]) // 第一次失败，第二次成功
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await markCompleted('job-1', { payload: { days: [1] } })

    expect(updates).toHaveLength(2) // 确实重试了一次
    expect(errSpy).toHaveBeenCalledTimes(1) // 只在失败时提醒一次，成功了不该再报
    errSpy.mockRestore()
  })

  it('markCompleted 重试后仍失败——把结果吼进日志，不能悄无声息地丢掉这次生成', async () => {
    const updates: Array<{ patch: Record<string, unknown>; eq: Array<[string, unknown]> }> = []
    mockUpdateOnly(updates, [{ message: 'down' }, { message: 'still down' }])
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await markCompleted('job-1', { payload: { days: [1] }, reply: 'irreplaceable result' })

    expect(updates).toHaveLength(2)
    // 第二条日志必须带上结果本身，否则这次生成就真的彻底找不回来了
    const loggedResult = errSpy.mock.calls.find((call) => String(call.join(' ')).includes('irreplaceable result'))
    expect(loggedResult).toBeTruthy()
    errSpy.mockRestore()
  })

  it('markFailed 写 failed 状态与错误信息，不把半截结果当成功存', async () => {
    const updates: Array<{ patch: Record<string, unknown>; eq: Array<[string, unknown]> }> = []
    mockUpdateOnly(updates)

    await markFailed('job-2', '行程内容过长，AI 一次没能写完就被截断了')

    expect(updates[0].patch.status).toBe('failed')
    expect(updates[0].patch.error).toBe('行程内容过长，AI 一次没能写完就被截断了')
    expect(updates[0].patch).not.toHaveProperty('result')
  })

  it('markRunning 只改 status，不动其他字段', async () => {
    const updates: Array<{ patch: Record<string, unknown>; eq: Array<[string, unknown]> }> = []
    mockUpdateOnly(updates)

    await markRunning('job-3')

    expect(updates[0].patch).toEqual({ status: 'running' })
  })
})
