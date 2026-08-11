/**
 * provider 适配器判据（Issue #883 / #917 · WP04A）。
 *
 * 🔴 一个真请求都不发 —— transport 全部是假件。
 */

import { describe, expect, it, vi } from 'vitest'
import { GeoBaselineOpenAiProvider, buildOutboundRequest, computeCostUsd } from '../provider'
import type { GeoOutboundRequest, GeoTransport, GeoTransportError, GeoTransportResult } from '../types'
import type { GeoProviderRequest } from '@/lib/geo-measurement-runtime'

const PRICING = { inputPerMillionUsd: 2.5, outputPerMillionUsd: 10 }
const CEILING = 0.05

function request(overrides: Partial<GeoProviderRequest> = {}): GeoProviderRequest {
  return {
    queryKey: 'q1',
    questionText: 'a frozen question from the approved query set',
    engineFamily: 'openai',
    modelVersion: 'gpt-4o-search-preview-2025-03-11',
    locale: 'en-NZ',
    market: 'nz',
    sampleIndex: 0,
    samplingParameters: { known: false, reason: 'not_recorded_by_source' },
    ...overrides,
  }
}

function okTransport(result: Partial<GeoTransportResult> = {}): {
  transport: GeoTransport
  seen: GeoOutboundRequest[]
} {
  const seen: GeoOutboundRequest[] = []
  const transport: GeoTransport = async (outbound) => {
    seen.push(outbound)
    return {
      resolvedModel: 'gpt-4o-search-preview-2025-03-11',
      text: 'answer',
      refusal: null,
      finishReason: 'stop',
      citationUrls: ['https://example.com/about'],
      promptTokens: 1000,
      completionTokens: 500,
      rawPayload: { id: 'chatcmpl-1', system_fingerprint: 'fp_x' },
      ...result,
    }
  }
  return { transport, seen }
}

function providerWith(transport: GeoTransport): GeoBaselineOpenAiProvider {
  return new GeoBaselineOpenAiProvider({
    transport,
    pricing: PRICING,
    perObservationCostCeilingUsd: CEILING,
    createTimeoutSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
  })
}

describe('身份直通（B10：WP04 没有 model / locale 装配闸，这道防线只能立在这里）', () => {
  it('计划里的 modelVersion 真的进了出站请求，不是 provider 自己的常量', async () => {
    const { transport, seen } = okTransport()
    await providerWith(transport).call(request())
    expect(seen).toHaveLength(1)
    expect(seen[0].model).toBe('gpt-4o-search-preview-2025-03-11')
  })

  it('计划里的 locale 真的进了出站请求（OpenAI 没有 locale 传输参数 ⇒ 落成 system 指令）', async () => {
    const { transport, seen } = okTransport()
    await providerWith(transport).call(request({ locale: 'zh-CN' }))
    expect(seen[0].localeDirective).toContain('zh-CN')
  })

  it('计划里的 market 落成结构化 user_location，不是提示词里的一句话', async () => {
    const { transport, seen } = okTransport()
    await providerWith(transport).call(request({ market: 'au' }))
    expect(seen[0].userLocation).toEqual({ country: 'AU', timezone: 'Australia/Sydney' })
  })

  it('market 表里没有 ⇒ fail closed，一个请求都不发（不猜、不退化成无地域）', async () => {
    const { transport, seen } = okTransport()
    const result = await providerWith(transport).call(request({ market: 'global' }))
    expect(seen).toHaveLength(0)
    expect(result).toMatchObject({ kind: 'error', errorCode: 'provider_cannot_honor_market' })
  })

  it("不复用 legacy 的 au-nz→NZ 有损映射：au-nz 不在表里就是拒，不是悄悄发 NZ", async () => {
    const { transport, seen } = okTransport()
    const result = await providerWith(transport).call(request({ market: 'au-nz' }))
    expect(seen).toHaveLength(0)
    expect(result).toMatchObject({ kind: 'error', errorCode: 'provider_cannot_honor_market' })
  })

  it('provider 回显的模型与计划钉的不一致 ⇒ 判失败，绝不写成成功', async () => {
    const { transport } = okTransport({ resolvedModel: 'gpt-4o-search-preview-2099-01-01' })
    const result = await providerWith(transport).call(request())
    expect(result.kind).toBe('error')
    expect(result).toMatchObject({ errorCode: 'provider_model_mismatch' })
    if (result.kind === 'error') {
      // 错误信息要能让人一步改对 manifest。
      expect(result.message).toContain('gpt-4o-search-preview-2099-01-01')
    }
  })

  it('请求引擎族与 provider 不符 ⇒ 拒，且不发请求', async () => {
    const { transport, seen } = okTransport()
    const result = await providerWith(transport).call(request({ engineFamily: 'anthropic' }))
    expect(seen).toHaveLength(0)
    expect(result).toMatchObject({ kind: 'error', errorCode: 'provider_engine_mismatch' })
  })
})

describe('四态分类（塌成一态 = 把「可安全重放」和「不许重放」当同一件事）', () => {
  it('成功 ⇒ ok，原始载荷封成信封，成本按用量算', async () => {
    const { transport } = okTransport()
    const result = await providerWith(transport).call(request())
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    // 1000/1e6*2.5 + 500/1e6*10 = 0.0025 + 0.005
    expect(result.costUsd).toBeCloseTo(0.0075, 10)
    const envelope = JSON.parse(result.rawResponse)
    expect(envelope.envelope).toBe('geo-baseline/openai/v1')
    expect(envelope.text).toBe('answer')
    expect(envelope.citationUrls).toEqual(['https://example.com/about'])
  })

  it('429 ⇒ rate_limited（未收费、重放安全），不是 error', async () => {
    const err = Object.assign(new Error('rate limited'), { status: 429 }) as GeoTransportError
    const result = await providerWith(async () => {
      throw err
    }).call(request())
    expect(result.kind).toBe('rate_limited')
  })

  it('中断 ⇒ timeout 且成本显式未知（WP04 据此不自动重放）', async () => {
    const err = Object.assign(new Error('aborted'), { isAbort: true }) as GeoTransportError
    const result = await providerWith(async () => {
      throw err
    }).call(request())
    expect(result.kind).toBe('timeout')
    if (result.kind !== 'timeout') return
    expect(result.costUsd.known).toBe(false)
  })

  it('AbortError 这个名字也算超时（不是所有实现都带 isAbort）', async () => {
    const err = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }) as GeoTransportError
    const result = await providerWith(async () => {
      throw err
    }).call(request())
    expect(result.kind).toBe('timeout')
  })

  it('其它 HTTP 错误 ⇒ error，错误码带上状态码', async () => {
    const err = Object.assign(new Error('bad request'), { status: 400 }) as GeoTransportError
    const result = await providerWith(async () => {
      throw err
    }).call(request())
    expect(result).toMatchObject({ kind: 'error', errorCode: 'provider_http_400', costUsd: 0 })
  })

  it('拿不到 token 用量 ⇒ 判失败，且按声明上界记账（钱已经花了，不许记 0）', async () => {
    const { transport } = okTransport({ promptTokens: null, completionTokens: null })
    const result = await providerWith(transport).call(request())
    expect(result).toMatchObject({ kind: 'error', errorCode: 'provider_cost_unknown', costUsd: CEILING })
  })
})

describe('已经打出去的调用必须记账（复审确认的最贵一条）', () => {
  it('模型对不上时，有用量就记**实际花费**，不是 0', async () => {
    const { transport } = okTransport({ resolvedModel: 'other-model' })
    const result = await providerWith(transport).call(request())
    expect(result.kind).toBe('error')
    if (result.kind !== 'error') return
    // 调用已经完成、已经计费；记 0 会让 knownSpent 永远不动、预算闸永不触发。
    expect(result.costUsd).toBeCloseTo(0.0075, 10)
  })

  it('模型对不上且拿不到用量 ⇒ 按声明上界保守记账', async () => {
    const { transport } = okTransport({
      resolvedModel: 'other-model',
      promptTokens: null,
      completionTokens: null,
    })
    const result = await providerWith(transport).call(request())
    expect(result).toMatchObject({ kind: 'error', errorCode: 'provider_model_mismatch', costUsd: CEILING })
  })

  it('🔴 模型一旦对不上就闩住：后续调用一个请求都不再发', async () => {
    const { transport, seen } = okTransport({ resolvedModel: 'other-model' })
    const provider = providerWith(transport)
    const first = await provider.call(request())
    expect(first).toMatchObject({ errorCode: 'provider_model_mismatch' })
    expect(seen).toHaveLength(1)

    // 不闩的话，一个 manifest 笔误会让 200 条计划观测发出 200 次真实计费调用，
    // 而 WP04 的批次级停跑只认「预算耗尽」和「成本不可信」，不认「一直在失败」。
    for (let i = 0; i < 5; i++) {
      const again = await provider.call(request())
      expect(again).toMatchObject({ kind: 'error', errorCode: 'provider_model_mismatch', costUsd: 0 })
    }
    expect(seen, '闩上之后不许再发请求').toHaveLength(1)
  })
})

describe('信封保真度（§4.4「供日后重新解析」）', () => {
  it('整个响应对象逐字进信封 —— 派生字段不够 WP05 用', async () => {
    const { transport } = okTransport()
    const result = await providerWith(transport).call(request())
    if (result.kind !== 'ok') throw new Error('should be ok')
    const envelope = JSON.parse(result.rawResponse)
    expect(envelope.rawPayload).toEqual({ id: 'chatcmpl-1', system_fingerprint: 'fp_x' })
    expect(envelope.refusal).toBeNull()
    expect(envelope.finishReason).toBe('stop')
  })

  it('正文为 null 时如实保留 null，不拿空串顶替', async () => {
    const { transport } = okTransport({ text: null, refusal: 'I cannot help with that', finishReason: 'content_filter' })
    const result = await providerWith(transport).call(request())
    if (result.kind !== 'ok') throw new Error('should be ok')
    const envelope = JSON.parse(result.rawResponse)
    expect(envelope.text).toBeNull()
    expect(envelope.refusal).toBe('I cannot help with that')
  })
})

describe('幂等声明', () => {
  it('一律 unsupported —— WP00 U8 要求逐个核实，本轮禁止调付费 API ⇒ 核实不了就不许声称支持', () => {
    const provider = providerWith(okTransport().transport)
    expect(provider.idempotency).toBe('unsupported')
  })
})

describe('超时真的会被触发', () => {
  it('timeoutMs 被传给信号工厂，且用完一定 dispose（否则 timer 泄漏）', async () => {
    const dispose = vi.fn()
    const create = vi.fn(() => ({ signal: new AbortController().signal, dispose }))
    const provider = new GeoBaselineOpenAiProvider({
      transport: okTransport().transport,
      pricing: PRICING,
      perObservationCostCeilingUsd: CEILING,
      timeoutMs: 1234,
      createTimeoutSignal: create,
    })
    await provider.call(request())
    expect(create).toHaveBeenCalledWith(1234)
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('transport 抛错时也 dispose', async () => {
    const dispose = vi.fn()
    const provider = new GeoBaselineOpenAiProvider({
      transport: async () => {
        throw new Error('boom')
      },
      pricing: PRICING,
      perObservationCostCeilingUsd: CEILING,
      createTimeoutSignal: () => ({ signal: new AbortController().signal, dispose }),
    })
    await provider.call(request())
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})

describe('纯函数', () => {
  it('buildOutboundRequest 对空 locale fail closed', () => {
    const built = buildOutboundRequest(request({ locale: '   ' }))
    expect(built.ok).toBe(false)
  })

  it('computeCostUsd 任一用量缺失即返回 null，不补 0', () => {
    expect(computeCostUsd(null, 5, PRICING)).toBeNull()
    expect(computeCostUsd(5, null, PRICING)).toBeNull()
    expect(computeCostUsd(0, 0, PRICING)).toBe(0)
  })
})
