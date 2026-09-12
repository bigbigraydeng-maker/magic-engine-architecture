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

export function tourLandscapePrompt(input: { client_name: string; market_scope?: string[]; client_products: unknown[]; competitor_products: unknown[]; memory_context?: string }): string {
  return `请为 ${input.client_name} 做竞品产品组合总览，而不是逐团横向配对。

本次分析范围：${input.market_scope?.length ? input.market_scope.join('、') : '客户当前配置的市场范围'}。
注意：竞品资料只来自客户指定的重点监控对象和页面，不代表这些竞品的完整产品线，也不代表整个市场全貌。不要使用“市场上所有”“竞品全部产品”等表述。CTS 产品资料是当前纳入本次分析的客户产品，不要据此声称 CTS 没有其他产品。
分析重点：消费者能感知的城市覆盖、行程长度、价格带、产品定位、出发季节和包含项目；最终告诉经营负责人现在应该做什么、暂时不要做什么、下一步先确认什么。不同路线和天数可以并存，不要把它们误判成同一产品。

客户产品事实：
${JSON.stringify(input.client_products).slice(0, 12000)}

竞品产品事实：
${JSON.stringify(input.competitor_products).slice(0, 18000)}

客户已确认的历史偏好与决策（只能作为背景，不能替代当前证据）：
${input.memory_context || '暂无已确认的客户 Memory。'}

输出字段：headline（不超过40字）、market_summary（2-4句，必须包含明确判断）、client_opportunities（最多4条，每条都要是“建议现在做”的具体动作）、client_risks（最多4条，每条都要是“暂时不要做”的具体动作或风险）、recommended_focus（最多4条，每条都要是下一步先确认的事项）、unknowns（最多4条，列出缺失的关键证据）、confidence（0到1）。
必须返回以上全部字段；没有证据时对应字段返回 []，不要省略字段。只返回 JSON，不要 Markdown 代码块。`
}

function cleanList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 4) : []
}

function fallbackTourLandscape(input: Parameters<typeof tourLandscapePrompt>[0]): TourLandscape {
  const scope = input.market_scope?.length ? input.market_scope.join('、') : '当前监控范围'
  const clientCount = input.client_products.length
  const competitorCount = input.competitor_products.length
  return {
    headline: competitorCount ? `${scope}已有竞品样本，先验证再调整产品` : `${scope}目前缺少足够竞品样本`,
    market_summary: `当前纳入分析的 CTS 产品有 ${clientCount} 个，重点监控样本有 ${competitorCount} 个。现有资料可以帮助发现城市、天数和价格带的方向，但不能代表竞品完整产品线或整个市场。`,
    client_opportunities: clientCount ? ['先选一个最重要的 CTS 产品，核对它与监控样本在城市、天数和包含项目上的消费者差异。'] : [],
    client_risks: ['暂时不要仅凭当前监控样本做全线降价或改动全部产品的决定。'],
    recommended_focus: ['先确认重点产品的完整路线、出发日期、余位和价格包含项目，再决定是否调整。'],
    unknowns: ['竞品完整产品线、真实出发窗口、余位和询盘转化数据仍未纳入。'],
    confidence: competitorCount > 0 && clientCount > 0 ? 0.35 : 0.2,
  }
}

export function validateTourLandscape(value: unknown): TourLandscape {
  const parsed = typeof value === 'string' ? parseJsonResponse(value) as unknown : value
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_tour_landscape')
  const item = parsed as Record<string, unknown>
  const confidenceValue = item.confidence ?? item.confidence_score
  const confidence = typeof confidenceValue === 'number' && Number.isFinite(confidenceValue) ? Math.max(0, Math.min(1, confidenceValue)) : 0
  if (typeof item.headline !== 'string' || typeof item.market_summary !== 'string') throw new Error('invalid_tour_landscape')
  return {
    headline: item.headline.slice(0, 120),
    market_summary: item.market_summary.slice(0, 1200),
    client_opportunities: cleanList(item.client_opportunities ?? item.opportunities),
    client_risks: cleanList(item.client_risks ?? item.risks),
    recommended_focus: cleanList(item.recommended_focus ?? item.recommendations),
    unknowns: cleanList(item.unknowns ?? item.missing_evidence),
    confidence,
  }
}

export async function summarizeTourLandscape(input: Parameters<typeof tourLandscapePrompt>[0]) {
  // Use the shared gateway path. This keeps the aggregate call observable and
  // consistent with the other Web Intelligence AI workflows in production.
  try {
    const result = await callClaudeChat({ model: TOUR_LANDSCAPE_MODEL, systemPrompt: SYSTEM, messages: [{ role: 'user', content: tourLandscapePrompt(input) }], maxOutputTokens: 1400 })
    return { landscape: validateTourLandscape(result.text), cost_usd: result.cost_usd, model: TOUR_LANDSCAPE_MODEL, prompt_version: TOUR_LANDSCAPE_PROMPT_VERSION, degraded: false }
  } catch (error) {
    console.warn('[wi-tour-landscape] AI unavailable; using evidence-bound fallback', error instanceof Error ? error.message : 'unknown_error')
    return { landscape: fallbackTourLandscape(input), cost_usd: 0, model: 'rules-fallback', prompt_version: TOUR_LANDSCAPE_PROMPT_VERSION, degraded: true }
  }
}

export async function chatAboutTourLandscape(input: {
  client_name: string
  client_products: unknown[]
  competitor_products: unknown[]
  market_scope?: string[]
  memory_context?: string
  landscape: TourLandscape | null
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  question: string
}) {
  const systemPrompt = `${SYSTEM} 你现在是一个经营决策对话助手。回答要直接、具体、少讲术语。
回答固定使用以下顺序：结论：一句话直接回答；依据：列出1-3条输入资料支持的事实；建议：给出一个下一步动作。只能使用提供的客户产品、竞品资料和当前总览；资料没有写的内容必须明确说“目前无法判断”。竞品资料是重点监控样本，不是竞品完整产品线；不要把样本结论扩大成整个市场结论。
不要把不同旅行社的 Tour 强行一一对应，不要建议自动调价、发布或执行外部动作。`
  const context = `当前总览：${JSON.stringify(input.landscape)}\n\n${tourLandscapePrompt({ client_name: input.client_name, market_scope: input.market_scope, client_products: input.client_products, competitor_products: input.competitor_products, memory_context: input.memory_context })}`
  try {
    const result = await callClaudeChat({
      model: TOUR_LANDSCAPE_MODEL,
      systemPrompt,
      messages: [...input.history.slice(-10), { role: 'user', content: `${context}\n\n用户问题：${input.question}` }],
      maxOutputTokens: 900,
    })
    return { text: result.text, cost_usd: result.cost_usd, model: TOUR_LANDSCAPE_MODEL, degraded: false }
  } catch (error) {
    console.warn('[wi-tour-landscape-chat] AI unavailable; using evidence-bound fallback', error instanceof Error ? error.message : 'unknown_error')
    const fallback = fallbackTourLandscape({ client_name: input.client_name, market_scope: input.market_scope, client_products: input.client_products, competitor_products: input.competitor_products })
    return {
      text: `结论：目前无法用 AI 进一步判断“${input.question}”。\n\n依据：当前分析范围内有 ${input.client_products.length} 个 CTS 产品和 ${input.competitor_products.length} 个重点竞品样本；这些样本不代表竞品完整产品线。\n\n建议：${fallback.recommended_focus[0] ?? '先补齐重点产品的路线、出发日期、余位和价格包含项目，再做经营调整。'}`,
      cost_usd: 0,
      model: 'rules-fallback',
      degraded: true,
    }
  }
}
