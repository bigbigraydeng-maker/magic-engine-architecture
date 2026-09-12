import { callClaudeChat, MODEL_HAIKU, parseJsonResponse } from '@/lib/anthropic/client'

export const TOUR_LANDSCAPE_MODEL = MODEL_HAIKU
export const TOUR_LANDSCAPE_PROMPT_VERSION = 'tour-landscape-v1'

export type TourLandscape = {
  headline: string
  market_summary: string
  client_opportunities: string[]
  client_risks: string[]
  recommended_focus: string[]
  unknowns: string[]
  confidence: number
}

const SYSTEM = '你是旅游产品竞争情报分析师。只根据输入事实做整体市场判断，不把不同旅行社的 Tour 强行视为一一对应产品。不得编造价格、日期、城市或余位。输出严格 JSON。'

export function tourLandscapePrompt(input: { client_name: string; client_products: unknown[]; competitor_products: unknown[] }): string {
  return `请为 ${input.client_name} 做竞品产品组合总览，而不是逐团横向配对。

分析重点：消费者能感知的城市覆盖、行程长度、价格带、产品定位、出发季节和包含项目；说明 CTS 可能的优势、短板和值得进一步验证的方向。不同路线和天数可以并存，不要把它们误判成同一产品。

客户产品事实：
${JSON.stringify(input.client_products).slice(0, 12000)}

竞品产品事实：
${JSON.stringify(input.competitor_products).slice(0, 18000)}

输出字段：headline（不超过40字）、market_summary（2-4句）、client_opportunities（最多4条）、client_risks（最多4条）、recommended_focus（最多4条）、unknowns（最多4条）、confidence（0到1）。`
}

function cleanList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 4) : []
}

export function validateTourLandscape(value: unknown): TourLandscape {
  const parsed = typeof value === 'string' ? parseJsonResponse(value) as unknown : value
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_tour_landscape')
  const item = parsed as Record<string, unknown>
  const confidence = typeof item.confidence === 'number' && Number.isFinite(item.confidence) ? Math.max(0, Math.min(1, item.confidence)) : 0
  if (typeof item.headline !== 'string' || typeof item.market_summary !== 'string') throw new Error('invalid_tour_landscape')
  return { headline: item.headline.slice(0, 120), market_summary: item.market_summary.slice(0, 1200), client_opportunities: cleanList(item.client_opportunities), client_risks: cleanList(item.client_risks), recommended_focus: cleanList(item.recommended_focus), unknowns: cleanList(item.unknowns), confidence }
}

export async function summarizeTourLandscape(input: Parameters<typeof tourLandscapePrompt>[0]) {
  // Use the shared gateway path. This keeps the aggregate call observable and
  // consistent with the other Web Intelligence AI workflows in production.
  const result = await callClaudeChat({ model: TOUR_LANDSCAPE_MODEL, systemPrompt: SYSTEM, messages: [{ role: 'user', content: tourLandscapePrompt(input) }], maxOutputTokens: 1200 })
  return { landscape: validateTourLandscape(result.text), cost_usd: result.cost_usd, model: TOUR_LANDSCAPE_MODEL, prompt_version: TOUR_LANDSCAPE_PROMPT_VERSION }
}
