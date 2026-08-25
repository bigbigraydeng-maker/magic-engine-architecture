/**
 * 张骞调用预算 + 降级路径回归测试。
 *
 * 背景(2026-08-25 取证):旧代码给每轮 Anthropic 调用一个写死的 150 s 上限,
 * 而"写最终报告"那一轮实测要 109-129 s;报告稍长就超时,SDK 又默认重试 2 次,
 * 450 s 后整单失败,**前面 8 轮采集到的材料全部丢弃**。生产上三次都是这么挂的。
 *
 * 这里锁住三件事:
 *   1. 中途某轮挂掉 → 不许整单失败,必须用已采集材料强制收尾;
 *   2. 每次调用都关掉 SDK 自动重试,且超时永远不超过剩余的 deadline;
 *   3. 真的救不回来时,抛出的错误必须带着已经花掉的钱(否则失败记录记成 $0)。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

interface RecordedCall {
  body: { tools?: unknown[]; messages: unknown[]; max_tokens: number }
  opts: { timeout?: number; maxRetries?: number }
}

const recorded: RecordedCall[] = []
/** 按顺序消费:Error 表示这一轮调用失败,对象表示这一轮的返回。 */
let script: Array<Error | Record<string, unknown>> = []

vi.mock('@/lib/anthropic/client', () => ({
  MODEL_SONNET: 'claude-sonnet-4-6',
  parseJsonResponse: (text: string) => {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('no JSON object found')
    return JSON.parse(match[0])
  },
  getAnthropicClient: () => ({
    messages: {
      create: (body: RecordedCall['body'], opts: RecordedCall['opts']) => {
        recorded.push({ body, opts })
        const next = script.shift()
        if (next === undefined) throw new Error('测试脚本用完了,说明实际调用次数比预期多')
        if (next instanceof Error) return Promise.reject(next)
        return Promise.resolve(next)
      },
    },
  }),
}))

import { runZhangqian, ZhangqianRunError } from '../agent'

/** 一轮"服务端还在搜,先暂停"的返回 —— 不触发任何客户端工具,便于纯控制流测试。 */
function pauseTurn(outputTokens = 120) {
  return {
    content: [{ type: 'text', text: '继续搜集中…' }],
    stop_reason: 'pause_turn',
    usage: { input_tokens: 15_000, output_tokens: outputTokens },
  }
}

/**
 * 收尾那一轮的返回。刻意给一段解析不出 JSON 的文本 ——
 * 本测试锁的是"挂了之后还能不能走到收尾",不是报告内容对不对
 * (报告 schema 由 validators.test.ts 负责)。解析失败会让 runZhangqian
 * 走 validation_error 分支直接返回,不会真的去打 SERP 接口。
 */
function unparseableFinal() {
  return {
    content: [{ type: 'text', text: '抱歉,材料不够,我没法给出完整报告。' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 30_000, output_tokens: 200 },
  }
}

const TIMEOUT_ERROR = Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' })

beforeEach(() => {
  recorded.length = 0
  script = []
})

describe('张骞调用预算与降级', () => {
  it('中途某轮超时:不整单失败,改用已采集材料强制收尾', async () => {
    script = [pauseTurn(), TIMEOUT_ERROR, unparseableFinal()]

    const result = await runZhangqian('example.co.nz')

    // 关键:它 resolve 了,而不是把 8 轮成果连同异常一起扔掉
    expect(result.report.meta.truncated).toBe(true)
    // 一共三次调用:成功一轮 + 失败一轮 + 强制收尾
    expect(recorded).toHaveLength(3)
    // 收尾那次必须不带 tools,否则模型会继续绕圈而不是交报告
    expect(recorded[2].body.tools).toBeUndefined()
  })

  it('每次调用都关掉 SDK 自动重试,且超时不超过剩余 deadline', async () => {
    script = [pauseTurn(), unparseableFinal(), unparseableFinal()]

    await runZhangqian('example.co.nz').catch(() => undefined)

    expect(recorded.length).toBeGreaterThan(0)
    for (const call of recorded) {
      // 重试是这次事故的放大器:一次超时被放大成三次(实测 450 s)
      expect(call.opts.maxRetries).toBe(0)
      expect(call.opts.timeout).toBeGreaterThan(0)
      // 单次调用永远不该超过全局墙钟(330 s)。这条同时锁住 GLOBAL_TIMEOUT_MS:
      // 谁把它调大而没重算 public-scan 9 分钟硬顶的五步路径,这里就会红。
      expect(call.opts.timeout).toBeLessThanOrEqual(330_000)
    }
  })

  it('超时与输出上限必须成对:不许出现"允许写的比写得完的多"', async () => {
    // Codex 复审 #1186 P1 抓到的正是这个矛盾:降级收尾只拿到 140 s,
    // 却仍允许写 12K tokens(光写就要 287 s)—— 救场那一步会再次超时,
    // 把已采集的材料原样丢掉,等于本 PR 要修的 bug 在兜底路径上复活。
    script = [pauseTurn(), TIMEOUT_ERROR, unparseableFinal()]

    await runZhangqian('example.co.nz').catch(() => undefined)

    expect(recorded.length).toBeGreaterThan(0)
    for (const call of recorded) {
      const timeout = call.opts.timeout ?? 0
      // 用代码里同一套保守参数反推:45 tokens/s + 20 s 开销
      const needMs = (call.body.max_tokens / 45) * 1000 + 20_000
      expect(needMs).toBeLessThanOrEqual(timeout + 1)
    }
  })

  it('deadline 已耗尽时收尾:输出上限必须跟着缩,不能还按 12K 写', async () => {
    // 上一条用的是"假响应立即返回",时间根本没流逝,所以 finalTimeoutMs 仍是满额
    // 287 s —— 那种情况下即使把 max_tokens 写死成 12K 也不会露馅(Codex 已提醒)。
    // 这里把 deadline 直接设成"马上到期",逼出真正的时间矛盾:收尾只拿得到
    // 兜底的 140 s,若仍允许写 12K(光写就要 287 s),救场那一步必然再次超时。
    script = [unparseableFinal()]

    await runZhangqian('example.co.nz', { deadlineAt: Date.now() + 1_000 })
      .catch(() => undefined)

    // 循环闸立刻判定时间不够,直接进强制收尾,所以只有这一次调用
    expect(recorded).toHaveLength(1)
    const finalCall = recorded[0]
    expect(finalCall.body.tools).toBeUndefined()
    const needMs = (finalCall.body.max_tokens / 45) * 1000 + 20_000
    expect(needMs).toBeLessThanOrEqual((finalCall.opts.timeout ?? 0) + 1)
  })

  it('调用方传进来的绝对 deadline 会夹住预算', async () => {
    // public-scan 的 9 分钟硬顶从它自己开始计时,agent 看不见前置抓取烧掉的时间。
    script = [unparseableFinal()]

    // 只给 200 s:比 agent 自己的 GLOBAL_TIMEOUT_MS(330 s)紧
    await runZhangqian('example.co.nz', { deadlineAt: Date.now() + 200_000 })
      .catch(() => undefined)

    expect(recorded).toHaveLength(1)
    expect(recorded[0].opts.timeout).toBeLessThanOrEqual(200_000)
  })

  it('第一轮就挂:没有任何材料可降级,抛出带成本的错误', async () => {
    script = [TIMEOUT_ERROR]

    await expect(runZhangqian('example.co.nz')).rejects.toBeInstanceOf(ZhangqianRunError)
    expect(recorded).toHaveLength(1)
  })

  it('连收尾都挂:错误里必须带上已经花掉的钱,不许记成 0', async () => {
    // 先成功一轮(产生真实 token 消耗),再失败,收尾也失败
    script = [pauseTurn(500), TIMEOUT_ERROR, TIMEOUT_ERROR]

    const err = await runZhangqian('example.co.nz').catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ZhangqianRunError)
    const runErr = err as ZhangqianRunError
    // 15,000 输入 + 500 输出 已经是真金白银,不能是 0
    expect(runErr.costUsd).toBeGreaterThan(0)
  })
})
