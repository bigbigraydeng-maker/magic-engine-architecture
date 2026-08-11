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

/** 把 SDK / HTTP 错误翻成 provider 分得开的形状。 */
function toTransportError(err: unknown): GeoTransportError {
  const base = err instanceof Error ? err : new Error(String(err))
  const e = base as GeoTransportError & { status?: number; name: string }
  // OpenAI SDK 的 APIError 带 status；AbortError 由 AbortSignal 触发。
  const status = (err as { status?: unknown })?.status
  if (typeof status === 'number') {
    Object.defineProperty(e, 'status', { value: status, enumerable: true })
  }
  if (base.name === 'AbortError' || base.name === 'TimeoutError') {
    Object.defineProperty(e, 'isAbort', { value: true, enumerable: true })
  }
  return e
}

/**
 * `gpt-4o-search-preview` 系模型把引用来源放在 assistant message 的 `annotations` 上，
 * 类型是 `url_citation`。SDK 没有给这些 annotation 类型定义，所以防御式收窄。
 *
 * 🔴 **不去重、不排序。** 原样保留是 `geo_evidence.raw_response` 的全部意义
 *    （GEO 契约 §4.4「日后用新 parser 重新解析」）。
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
 * 🔴 `web_search_options` 是 `gpt-4o-search-preview` 系支持、但公共类型定义里没有的字段
 *    （与 `src/lib/ai-tracker/runners/openai.ts:42-49` 同一处已知情况）。
 * 🔴 `signal` 一路传到 SDK —— 超时必须真的能打断请求，否则 provider 那条 timeout 分支
 *    永远不会触发，「计费未知不许重放」这条闸就是摆设。
 */
export const openAiTransport: GeoTransport = async (
  request: GeoOutboundRequest,
  signal: AbortSignal,
): Promise<GeoTransportResult> => {
  const client = getOpenAIClient()
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
    response = await client.chat.completions.create(params, { signal })
  } catch (err) {
    throw toTransportError(err)
  }

  const choice = response.choices[0]
  return {
    // 🔴 provider **回显**的模型，不是我们请求的那个 —— 身份核对靠它（见 provider.ts）。
    resolvedModel: response.model,
    text: choice?.message?.content ?? '',
    citationUrls: extractCitationUrls(choice?.message),
    promptTokens: response.usage?.prompt_tokens ?? null,
    completionTokens: response.usage?.completion_tokens ?? null,
  }
}
