import type Anthropic from '@anthropic-ai/sdk'

/**
 * 团资料抽取的工具 schema。
 *
 * 设计移植自 CTS 网站仓库自己的解析原型（/Users/raydeng/Projects/chinatravel/
 * src/lib/tour-parser/schema.ts）——那份原型没有落库、没有发布能力，
 * 但"不许编价格/日期、SOURCE A 行程权威 vs SOURCE B 营销材料、
 * confidenceNotes/clientClaimsToVerify/missingFields"这套设计本身很扎实，
 * 直接借鉴。跟原版的差异：
 *   - departureDates / departurePricing 两个平行字段合并成一个 departures
 *     数组（date+price 成对）——避免 AI 分两次生成同一份日期列表时
 *     两边悄悄对不上（真实会发生：拼写/空格差异，build 不报错，
 *     CTS 网站那个价格直接静默不渲染）
 *   - 字段命名走平台通用（GroupTourPayload），不直接对齐 CTS Tour 接口拼写；
 *     CTS 专属字段名映射在 publisher.ts 里做
 *
 * 用强制 tool-use（不是 output_config.format）—— 这是本仓库 tailor-made/extract.ts
 * 已经验证过在这个 SDK 版本（^0.32.1）上稳定工作的模式，JSON 合法性由 API
 * 侧的 tool-use 机制保证，不用正则/jsonrepair 兜底。
 */

const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] } as const

export const SUBMIT_GROUP_TOUR_TOOL: Anthropic.Tool = {
  name: 'submit_group_tour',
  description: '提交从团资料文档解析出的结构化团数据',
  input_schema: {
    type: 'object',
    properties: {
      destination: {
        type: 'string',
        enum: ['china', 'japan', 'vietnam'],
        description: 'Which country this tour visits, inferred from the itinerary cities/hotels. Determines the publish URL path.',
      },
      name: {
        type: 'string',
        description: 'Product name, e.g. "China Discovery — Golden China". Infer destination and style from the document.',
      },
      title: { type: 'string', description: 'Full display title for the tour page hero.' },
      shortDescription: {
        type: 'string',
        description: 'One or two sentences describing the tour, for cards and listings.',
      },
      duration: {
        type: 'string',
        description: 'Duration exactly as the document states, e.g. "12 Days". Count itinerary days if not stated explicitly.',
      },
      price: {
        ...nullableString,
        description: 'Lead-in twin-share price, e.g. "From NZD $4,999 per person". null if the document states no price.',
      },
      singleSupplement: {
        ...nullableString,
        description: 'Single room supplement, e.g. "NZD $690". null if not stated.',
      },
      departures: {
        type: 'array',
        description:
          'Scheduled departures. Empty array if the document lists none. Do not invent dates. Each departure pairs its date with its price so the two can never drift apart.',
        items: {
          type: 'object',
          required: ['date', 'price'],
          properties: {
            date: {
              type: 'string',
              description: 'Departure date, day + full month name + four-digit year, e.g. "16 November 2026".',
            },
            price: {
              ...nullableString,
              description: 'Price specific to this departure. null when it shares the lead-in price, or when not stated.',
            },
          },
        },
      },
      tourCities: {
        type: 'array',
        description: 'Cities actually stayed overnight or toured, in travel order, as lowercase slugs, e.g. ["beijing","xian","shanghai"]. Exclude the origin city / transit airports (e.g. Auckland, Sydney) — only include a stop if the traveller stays there or has a scheduled visit.',
        items: { type: 'string' },
      },
      highlights: {
        type: 'array',
        description: '4-6 highlights, each a short phrase. Drawn from the document, not invented.',
        items: { type: 'string' },
      },
      sellingPoints: {
        type: 'array',
        description:
          "Selling points for travellers. When SOURCE B (client's own selling points) is supplied, use it as the primary input — keep their angle and voice, tighten only unclear or ungrammatical English. When there is no SOURCE B, write these from the itinerary and every claim must be supported by it.",
        items: { type: 'string' },
      },
      itinerary: {
        type: 'array',
        description: 'Day-by-day itinerary, one entry per day, in order, starting at day 1.',
        items: {
          type: 'object',
          required: ['day', 'title', 'description', 'meals', 'accommodation'],
          properties: {
            day: { type: 'integer' },
            title: { type: 'string', description: 'Day title, usually the route, e.g. "Beijing — Xi\'an".' },
            description: { type: 'string', description: 'What happens that day, in prose.' },
            meals: {
              type: 'array',
              items: { type: 'string', enum: ['Breakfast', 'Lunch', 'Dinner'] },
              description: 'Meals included that day. Empty array if none.',
            },
            accommodation: { ...nullableString, description: 'Hotel or hotel class for that night. null if not stated.' },
          },
        },
      },
      inclusions: { type: 'array', description: "What's included in the price.", items: { type: 'string' } },
      exclusions: { type: 'array', description: "What's not included.", items: { type: 'string' } },
      suggestedTier: {
        type: 'string',
        enum: ['signature', 'discovery', 'stopover'],
        description:
          'CTS product tier. Duration is the most reliable signal, weigh it before price. stopover: 2-5 days, no scheduled departures. discovery: 10-15 days, roughly NZD $2,999-3,899. signature: 16-27 days, roughly NZD $7,999-10,899. If duration and price disagree, follow duration and say so in confidenceNotes.',
      },
      tierReasoning: {
        type: 'string',
        description:
          'Written in Simplified Chinese for the CTS reviewer. One or two sentences on why that tier, leading with duration and price. Quotes from the source stay in original English inside 「」.',
      },
      suggestedSlug: {
        type: 'string',
        description: 'URL slug, lowercase kebab-case, e.g. "golden-china". No destination or tier prefix.',
      },
      metaTitle: { type: 'string', description: 'SEO title, under 60 characters.' },
      metaDescription: { type: 'string', description: 'SEO meta description, 140-160 characters.' },
      clientClaimsToVerify: {
        type: 'array',
        description:
          "Claims in SOURCE B that the itinerary does not support or contradicts. CTS must not publish an unverifiable claim, so surface each one rather than dropping or silently repeating it. Empty array when there is no SOURCE B, or every claim checks out.",
        items: {
          type: 'object',
          required: ['claim', 'issue'],
          properties: {
            claim: { type: 'string', description: "The client's claim, quoted VERBATIM in its original language." },
            issue: {
              type: 'string',
              description: 'Written in Simplified Chinese for the CTS reviewer. Quoted itinerary words stay in original English inside 「」.',
            },
          },
        },
      },
      blogAngles: {
        type: 'array',
        description: 'Three to five blog angles this tour could support, for the content team.',
        items: {
          type: 'object',
          required: ['title', 'angle'],
          properties: {
            title: { type: 'string' },
            angle: { type: 'string' },
          },
        },
      },
      missingFields: {
        type: 'array',
        description: "Fields returned as null/empty because the source did not contain them — the reviewer's to-do list. Use exact field names from this schema.",
        items: { type: 'string' },
      },
      confidenceNotes: {
        type: 'array',
        description:
          'Anything uncertain — ambiguous pricing, unclear dates, contradictions in the source. Written in Simplified Chinese for the reviewer; quoted source words stay in original English inside 「」. Empty array if the source was unambiguous.',
        items: { type: 'string' },
      },
    },
    required: [
      'destination', 'name', 'title', 'shortDescription', 'duration', 'price', 'singleSupplement',
      'departures', 'tourCities', 'highlights', 'sellingPoints', 'itinerary',
      'inclusions', 'exclusions', 'suggestedTier', 'tierReasoning', 'suggestedSlug',
      'metaTitle', 'metaDescription', 'clientClaimsToVerify', 'blogAngles',
      'missingFields', 'confidenceNotes',
    ],
  },
}
