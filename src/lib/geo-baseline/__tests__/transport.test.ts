/**
 * 传输层错误分类判据（Issue #883 / #917 · WP04A）。
 *
 * 🔴 **这个文件存在的唯一理由是一次真实的复审发现**：原来按 `err.name === 'AbortError'`
 *    判超时，而 openai SDK 的错误类**从不设置 `this.name`** —— 实测
 *    `new APIUserAbortError().name === 'Error'`、`.status === undefined`。
 *    于是那条 timeout 分支在生产里永远到不了：每一次真超时都会被记成
 *    「明确错误 + 确定花了 $0」，而那恰恰是四态设计要防的那一种不诚实
 *    （计费未知被写成计费已知），并且会让 `worstCaseSpent` 永远不动、预算闸形同虚设。
 *
 * 🔴 这些测试**直接对着安装的 SDK 错误类构造实例**，不发任何网络请求。
 *    SDK 升级后行为若变了，这里会当场红 —— 这正是要钉住的东西。
 */

import { describe, expect, it } from 'vitest'
import { APIConnectionTimeoutError, APIError, APIUserAbortError } from 'openai'
import { createOpenAiTransport, toTransportError } from '../transport-openai'
import type { OpenAiChatClient } from '../transport-openai'

function abortedSignal(): AbortSignal {
  const c = new AbortController()
  c.abort()
  return c.signal
}

const liveSignal = (): AbortSignal => new AbortController().signal

describe('SDK 真实形状（钉住让我踩坑的那件事）', () => {
  it('APIUserAbortError 的 name 是 "Error"、status 是 undefined —— 按 name 判超时必然失效', () => {
    const err = new APIUserAbortError()
    expect(err.name).toBe('Error')
    expect((err as unknown as { status?: unknown }).status).toBeUndefined()
  })

  it('APIConnectionTimeoutError 同理', () => {
    const err = new APIConnectionTimeoutError({ message: 'timed out' })
    expect(err.name).toBe('Error')
    expect((err as unknown as { status?: unknown }).status).toBeUndefined()
  })
})

describe('中断判定', () => {
  it('信号已中断 ⇒ isAbort，哪怕错误对象什么线索都不给', () => {
    const e = toTransportError(new Error('socket hang up'), abortedSignal())
    expect(e.isAbort).toBe(true)
  })

  it('SDK 的 APIUserAbortError ⇒ isAbort（靠构造函数名，不靠 name）', () => {
    const e = toTransportError(new APIUserAbortError(), liveSignal())
    expect(e.isAbort).toBe(true)
  })

  it('SDK 的 APIConnectionTimeoutError ⇒ isAbort', () => {
    const e = toTransportError(new APIConnectionTimeoutError({ message: 'x' }), liveSignal())
    expect(e.isAbort).toBe(true)
  })

  it('原生 AbortError 名字 ⇒ isAbort', () => {
    const e = toTransportError(Object.assign(new Error('x'), { name: 'AbortError' }), liveSignal())
    expect(e.isAbort).toBe(true)
  })

  it('普通错误 + 信号没中断 ⇒ 不是超时（不许把别的错误也算成计费未知）', () => {
    const e = toTransportError(new Error('bad request'), liveSignal())
    expect(e.isAbort).toBeUndefined()
  })
})

describe('状态码透传', () => {
  it('APIError 的 status 带得出来（429 才分得出限流）', () => {
    const err = new APIError(429, { error: { message: 'rate limited' } }, 'rate limited', undefined)
    const e = toTransportError(err, liveSignal())
    expect(e.status).toBe(429)
    expect(e.isAbort).toBeUndefined()
  })

  it('非 Error 的抛出物也不会让分类崩掉', () => {
    const e = toTransportError('just a string', liveSignal())
    expect(e).toBeInstanceOf(Error)
    expect(e.message).toContain('just a string')
  })
})


describe('🔴 必须关掉 SDK 的自动重试', () => {
  function fakeClient(): { client: OpenAiChatClient; opts: { signal: AbortSignal; maxRetries: number }[] } {
    const opts: { signal: AbortSignal; maxRetries: number }[] = []
    const client: OpenAiChatClient = {
      chat: {
        completions: {
          create: async (_params, options) => {
            opts.push(options)
            return {
              model: 'm',
              choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            } as never
          },
        },
      },
    }
    return { client, opts }
  }

  it('每次请求都带 maxRetries: 0', async () => {
    const { client, opts } = fakeClient()
    const transport = createOpenAiTransport(() => client)
    await transport(
      {
        model: 'm',
        question: 'q',
        localeDirective: 'Answer in en-NZ.',
        userLocation: { country: 'NZ', timezone: 'Pacific/Auckland' },
      },
      liveSignal(),
    )
    // SDK 默认 maxRetries=2 会在 408/409/429/5xx 与连接错误上自动重放。
    // 而本 provider 声明 idempotency:'unsupported' —— 一条记账一次的观测背后
    // 可能是三次真实计费，预算闸算一份、实际花三份。
    expect(opts).toHaveLength(1)
    expect(opts[0].maxRetries).toBe(0)
  })

  it('signal 一路传到 SDK（否则超时打断不了请求，那条闸就是摆设）', async () => {
    const { client, opts } = fakeClient()
    const signal = liveSignal()
    await createOpenAiTransport(() => client)(
      {
        model: 'm',
        question: 'q',
        localeDirective: 'd',
        userLocation: { country: 'NZ', timezone: 'Pacific/Auckland' },
      },
      signal,
    )
    expect(opts[0].signal).toBe(signal)
  })

  it('locale 指令与 user_location 真的进了出站参数', async () => {
    const seen: unknown[] = []
    const client: OpenAiChatClient = {
      chat: {
        completions: {
          create: async (params, _o) => {
            seen.push(params)
            return {
              model: 'm',
              choices: [{ message: { content: 'x' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            } as never
          },
        },
      },
    }
    await createOpenAiTransport(() => client)(
      {
        model: 'pinned-model',
        question: 'the question',
        localeDirective: 'Answer in zh-CN.',
        userLocation: { country: 'AU', timezone: 'Australia/Sydney' },
      },
      liveSignal(),
    )
    const p = seen[0] as Record<string, unknown>
    expect(p.model).toBe('pinned-model')
    expect(JSON.stringify(p)).toContain('Answer in zh-CN.')
    expect(JSON.stringify(p)).toContain('Australia/Sydney')
  })
})
