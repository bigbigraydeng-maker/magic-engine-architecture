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
  body: { tools?: unknown[]; messages: unknown[] }
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
      // 全局墙钟 380 s + 收尾兜底 140 s,任何单次调用都不该超过这个量级
      expect(call.opts.timeout).toBeLessThanOrEqual(380_000)
    }
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
