/**
 * Magic Engine 2.0 · GEO Baseline —— 真实 OpenAI 传输层（Issue #883 / #917 · WP04A）
 *
 * 🔴 **这是全模块唯一会发出网络请求的文件。** 单独成文件，是为了让 provider 的四态分类、
 *    身份直通、成本核算全部能对着假 transport 跑，测试里一个真请求都不发。
 *
 * 🔴 SDK 客户端在函数内部初始化（CLAUDE.md 铁律 7），不在模块顶层。
 *
 * 🔴 **不解释、不规范化、不去重。** 这一层只负责「把响应原样搬出来」；
 *    解释是 parser 的事（WP02 §3.1 采集身份 vs §3.3 解释身份的分离）。
 */

import type OpenAI from 'openai'
import { getOpenAIClient } from '@/lib/ai/openai-client'
import type { GeoOutboundRequest, GeoTransport, GeoTransportError, GeoTransportResult } from './types'

/**
 * 把 SDK / HTTP 错误翻成 provider 分得开的形状。
 *
 * 🔴 **中断判定只信 `signal.aborted`，不信错误的 `name`。** 复审实测（openai@6.33.0）：
 *    `new APIUserAbortError().name === 'Error'`、`.status === undefined` —— SDK 的错误类
 *    **从不设置 `this.name`**，而且 `client.js` 会把原生 AbortError 统一转成
 *    `APIUserAbortError`。所以按 `name === 'AbortError'` 判断的那道分支在生产里
 *    **永远到不了**：每一次真超时都会掉进「明确错误 + 确定花了 $0」，
 *    而那恰恰是四态设计要防的那一种不诚实（计费未知被写成计费已知）。
 *    信号本身是权威的：是我们自己中止的，就是我们自己中止的。
 */
export function toTransportError(err: unknown, signal: AbortSignal): GeoTransportError {
  const base = err instanceof Error ? err : new Error(String(err))
  const e = base as GeoTransportError & { status?: number; isAbort?: boolean }
  const status = (err as { status?: unknown })?.status
  if (typeof status === 'number') {
    Object.defineProperty(e, 'status', { value: status, enumerable: true })
  }
  const ctor = (err as { constructor?: { name?: string } })?.constructor?.name
  const aborted =
    signal.aborted ||
    base.name === 'AbortError' ||
    base.name === 'TimeoutError' ||
    ctor === 'APIUserAbortError' ||
    ctor === 'APIConnectionTimeoutError'
  if (aborted) {
    Object.defineProperty(e, 'isAbort', { value: true, enumerable: true })
  }
  return e
}

/**
 * `gpt-4o-search-preview` 系模型把引用来源放在 assistant message 的 `annotations` 上，
 * 类型是 `url_citation`。SDK 没有给这些 annotation 类型定义，所以防御式收窄。
 *
 * 🔴 **不去重、不排序。** 这只是给 v1 parser 用的派生视图；
 *    真正的「逐字保留」靠 {@link GeoTransportResult.rawPayload}（整个响应对象）。
 */
function extractCitationUrls(message: unknown): string[] {
  if (!message || typeof message !== 'object') return []
  const annotations = (message as { annotations?: unknown }).annotations
  if (!Array.isArray(annotations)) return []
  const urls: string[] = []
  for (const anno of annotations) {
    if (!anno || typeof anno !== 'object') continue
    const a = anno as { type?: string; url_citation?: { url?: string } }
    if (a.type === 'url_citation' && typeof a.url_citation?.url === 'string') {
      urls.push(a.url_citation.url)
    }
  }
  return urls
}

/**
 * 真实传输层。
 *
 * 🔴 `signal` 一路传到 SDK —— 超时必须真的能打断请求，否则 provider 那条 timeout 分支
 *    永远不会触发，「计费未知不许重放」这条闸就是摆设。
 *
 * 🔴 **`maxRetries: 0` 是硬要求，不是调优。** SDK 默认 `maxRetries ?? 2`
 *    （`node_modules/openai/client.js:148`，实测确认），会在连接错误 / 408 / 409 / 429 / 5xx
 *    上**自动重放**。而本 provider 对外声明 `idempotency: 'unsupported'` ——
 *    也就是「这家 provider 不保证同一请求不重复收费」。两者同时成立时，一条被记账一次的
 *    观测背后可能是**三次真实计费**，预算闸算的是一份、实际花的是三份。
 *    重试要不要做、怎么做，归 WP04 的有界尝试循环管（它每次重试前重新 preflight）。
 */
/** 每次请求都带的选项。**`maxRetries: 0` 是硬要求** —— 见 {@link createOpenAiTransport}。 */
export const TRANSPORT_REQUEST_OPTIONS = Object.freeze({ maxRetries: 0 })

/** 最小的 OpenAI 客户端形状 —— 只要求本模块真正用到的那一个方法，便于注入假件。 */
export interface OpenAiChatClient {
  chat: {
    completions: {
      create(
        params: OpenAI.ChatCompletionCreateParamsNonStreaming,
        options: { signal: AbortSignal; maxRetries: number },
      ): Promise<OpenAI.ChatCompletion>
    }
  }
}

export function createOpenAiTransport(getClient: () => OpenAiChatClient): GeoTransport {
  return async (request: GeoOutboundRequest, signal: AbortSignal): Promise<GeoTransportResult> => {
  const client = getClient()
  const params = {
    model: request.model,
    messages: [
      { role: 'system' as const, content: request.localeDirective },
      { role: 'user' as const, content: request.question },
    ],
    web_search_options: {
      user_location: {
        type: 'approximate' as const,
        approximate: {
          country: request.userLocation.country,
          timezone: request.userLocation.timezone,
        },
      },
    },
  } as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming

  let response: OpenAI.ChatCompletion
  try {
    response = await client.chat.completions.create(params, { signal, ...TRANSPORT_REQUEST_OPTIONS })
  } catch (err) {
    throw toTransportError(err, signal)
  }

  const choice = response.choices[0]
  const message = choice?.message as { content?: string | null; refusal?: string | null } | undefined
  return {
    // 🔴 provider **回显**的模型，不是我们请求的那个 —— 身份核对靠它（见 provider.ts）。
    resolvedModel: response.model,
    // 🔴 `content` 保持可空。`?? ''` 会把「模型拒答」「返回空串」「压根没有 choice」
    //    三件不同的事压成同一个值，而观测行是不可变的 —— 压掉了就永远分不开了。
    text: message?.content ?? null,
    refusal: message?.refusal ?? null,
    finishReason: choice?.finish_reason ?? null,
    citationUrls: extractCitationUrls(choice?.message),
    promptTokens: response.usage?.prompt_tokens ?? null,
    completionTokens: response.usage?.completion_tokens ?? null,
    // 🔴 **逐字保留整个响应对象。** GEO 契约 §4.4 要求逐字保留原始响应的理由是
    //    「日后用新 parser 重新解析」（§6.1 第 2 条可比性判据依赖它）。上面那些派生字段
    //    只够 v1 parser 用；`url_citation.title` / `start_index` / `end_index`
    //    （引用在正文里的位置 —— 「限定性提及」这类指标的原料）、`system_fingerprint`、
    //    多个 choice 等等都不在里面。而观测行不可变、补不回来 ——
    //    六个月后 WP05 要算 M1 指标时才发现缺料，只能重跑，而重跑意味着**基线时间点丢了**。
    rawPayload: response as unknown as Record<string, unknown>,
    }
  }
}

/** 生产实例：走 Cloudflare AI Gateway 的共享工厂。 */
export const openAiTransport: GeoTransport = createOpenAiTransport(
  () => getOpenAIClient() as unknown as OpenAiChatClient,
)
