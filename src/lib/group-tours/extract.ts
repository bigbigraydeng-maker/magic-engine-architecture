import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClientDirect, MODEL_SONNET } from '@/lib/anthropic/client'
import { SUBMIT_GROUP_TOUR_TOOL } from './schema'
import type { GroupTourPayload, GroupTourClaim, GroupTourBlogAngle } from './types'

/**
 * 团资料文档 → 结构化团数据。
 *
 * 铁律（跟 tailor-made/extract.ts 一致）：只许照抄，不许编。文档没写的
 * 价格 / 日期 / 酒店，一律留空并进 missingFields，由人工确认 —— 编一个
 * 不存在的价格，比少一行信息严重得多，这是要挂上真实客户官网的数据。
 */

const SYSTEM_PROMPT = `You extract structured group-tour data from tour operator itinerary documents for a New Zealand travel agency.

Your output is a DRAFT a human reviewer will check before it goes on the website. Two rules above all others:

1. Never invent. If the document does not state a price, a departure date, a hotel, or a meal, return null (or an empty array) and name that field in missingFields. A fabricated price is a commercial incident; a null is a five-second fix for the reviewer.
2. Flag ambiguity rather than resolving it silently. If pricing is contradictory, dates lack a year, or the day count disagrees with the stated duration, record it in confidenceNotes and use your best reading for the field itself.

Two audiences, two languages. Product content — name, title, shortDescription, highlights, sellingPoints, itinerary, inclusions, exclusions, metaTitle, metaDescription — is published on an English-language website and must be in English. Reviewer content — tierReasoning, the issue text in clientClaimsToVerify, and confidenceNotes — is read by an Auckland-based product team and must be in Simplified Chinese. Quotations are the exception: whenever you quote the source in a Chinese field, the quoted words stay in the original English inside 「」, so the reviewer can match them against the document.

House conventions:
- Dates: "16 November 2026" — day, full month name, four-digit year. If the source omits the year, infer it from context and note that inference in confidenceNotes.
- Prices: "NZD $4,999" or "From NZD $4,999 per person". Keep the operator's currency if it is clearly not NZD, and flag it.
- Duration: "12 Days".
- City slugs: lowercase, no spaces or accents.
- Meals: only "Breakfast", "Lunch", "Dinner".

You may be given two sources. SOURCE A, the itinerary document, is the factual authority — dates, prices, day count, hotels, inclusions come from it and nowhere else. SOURCE B, when present, is the client's own selling points — their positioning and voice. Use SOURCE B for sellingPoints, and let it inform highlights, shortDescription and the SEO fields — but never let it establish a fact. If SOURCE B claims something SOURCE A does not support, the itinerary wins for the data fields, and the claim goes in clientClaimsToVerify.

Preserve the operator's own wording for itinerary descriptions, inclusions and exclusions — tighten grammar, but do not rewrite the substance or add attractions the document does not mention.

You must call the submit_group_tour tool with your result. Do not reply with plain text.`

const INSTRUCTION = `Extract this tour into the required structure.

Work through the whole document before answering — pricing and departure dates are often in a table, a footer, or a separate section from the day-by-day itinerary. Pair each departure date with its own price in the same departures[] entry — do not produce the date list and the price list separately.

Then set suggestedTier by what the document actually says about duration, hotel class and price, and explain that call in tierReasoning.

Finish by filling missingFields and confidenceNotes honestly. An empty confidenceNotes means you are telling the reviewer the source was unambiguous — only say that when it is true.`

export class GroupTourExtractionError extends Error {}

export interface ExtractGroupTourResult {
  payload: GroupTourPayload
  clientClaimsToVerify: GroupTourClaim[]
  blogAngles: GroupTourBlogAngle[]
  missingFields: string[]
  confidenceNotes: string[]
  usage: { inputTokens: number; outputTokens: number }
}

/** 工具返回的原始形状 —— 与 SUBMIT_GROUP_TOUR_TOOL.input_schema 一一对应 */
interface RawToolInput {
  destination: 'china' | 'japan' | 'vietnam'
  name: string
  title: string
  shortDescription: string
  duration: string
  price: string | null
  singleSupplement: string | null
  departures: Array<{ date: string; price: string | null }>
  tourCities: string[]
  highlights: string[]
  sellingPoints: string[]
  itinerary: Array<{
    day: number
    title: string
    description: string
    meals: Array<'Breakfast' | 'Lunch' | 'Dinner'>
    accommodation: string | null
  }>
  inclusions: string[]
  exclusions: string[]
  suggestedTier: 'signature' | 'discovery' | 'stopover'
  tierReasoning: string
  suggestedSlug: string
  metaTitle: string
  metaDescription: string
  clientClaimsToVerify: GroupTourClaim[]
  blogAngles: GroupTourBlogAngle[]
  missingFields: string[]
  confidenceNotes: string[]
}

/**
 * @param itineraryText  行程文档转出的纯文本（SOURCE A，事实权威）
 * @param sellingPointsText 客户卖点材料转出的纯文本，可选（SOURCE B，仅供参考，不当事实）
 * @throws GroupTourExtractionError 缺 API key / 模型拒答 / 输出被截断 / 没有 tool_use
 */
export async function extractGroupTour(params: {
  itineraryText: string
  sellingPointsText?: string | null
}): Promise<ExtractGroupTourResult> {
  const { itineraryText, sellingPointsText } = params

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new GroupTourExtractionError('缺少 ANTHROPIC_API_KEY 环境变量。')
  }

  const userParts = [
    '=== SOURCE A — ITINERARY DOCUMENT (factual authority: dates, prices, days, hotels, inclusions) ===',
    itineraryText,
  ]
  if (sellingPointsText?.trim()) {
    userParts.push(
      "=== SOURCE B — CLIENT'S OWN SELLING POINTS (marketing positioning and voice; NOT a source of itinerary facts) ===",
      sellingPointsText.trim(),
    )
  }
  userParts.push(INSTRUCTION)

  // 长行程（十几天）走直连，避开 CF AI Gateway ~60s 超时（同 tailor-made/extract.ts 的理由）
  const client = getAnthropicClientDirect()

  let message: Anthropic.Message
  try {
    message = await client.messages.create({
      model: MODEL_SONNET,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userParts.join('\n\n') }],
      tools: [SUBMIT_GROUP_TOUR_TOOL],
      tool_choice: { type: 'tool', name: SUBMIT_GROUP_TOUR_TOOL.name },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new GroupTourExtractionError(`模型调用失败：${msg}`)
  }

  if (message.stop_reason === 'max_tokens') {
    throw new GroupTourExtractionError('行程太长，输出被截断，请拆分文档后重试。')
  }

  const toolUse = message.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === SUBMIT_GROUP_TOUR_TOOL.name,
  )
  if (!toolUse) {
    throw new GroupTourExtractionError('模型没有返回结构化结果。')
  }

  const raw = toolUse.input as RawToolInput

  const payload: GroupTourPayload = {
    destination: raw.destination ?? null,
    name: raw.name ?? '',
    title: raw.title ?? '',
    shortDescription: raw.shortDescription ?? '',
    duration: raw.duration ?? '',
    price: raw.price ?? null,
    singleSupplement: raw.singleSupplement ?? null,
    departures: Array.isArray(raw.departures) ? raw.departures : [],
    tourCities: Array.isArray(raw.tourCities) ? raw.tourCities : [],
    highlights: Array.isArray(raw.highlights) ? raw.highlights : [],
    sellingPoints: Array.isArray(raw.sellingPoints) ? raw.sellingPoints : [],
    itinerary: (Array.isArray(raw.itinerary) ? raw.itinerary : []).map((d, i) => ({
      day: i + 1,
      title: d.title ?? '',
      description: d.description ?? '',
      meals: Array.isArray(d.meals) ? d.meals : [],
      accommodation: d.accommodation ?? null,
    })),
    inclusions: Array.isArray(raw.inclusions) ? raw.inclusions : [],
    exclusions: Array.isArray(raw.exclusions) ? raw.exclusions : [],
    heroImage: null,
    gallery: [],
    metaTitle: raw.metaTitle ?? '',
    metaDescription: raw.metaDescription ?? '',
    suggestedTier: raw.suggestedTier ?? null,
    tierReasoning: raw.tierReasoning ?? '',
    suggestedSlug: raw.suggestedSlug ?? '',
  }

  return {
    payload,
    clientClaimsToVerify: Array.isArray(raw.clientClaimsToVerify) ? raw.clientClaimsToVerify : [],
    blogAngles: Array.isArray(raw.blogAngles) ? raw.blogAngles : [],
    missingFields: Array.isArray(raw.missingFields) ? raw.missingFields : [],
    confidenceNotes: Array.isArray(raw.confidenceNotes) ? raw.confidenceNotes : [],
    usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
  }
}
