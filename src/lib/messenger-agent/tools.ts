/**
 * CTS Governed Reply Agent — 4 只读工具(Issue #1580)。
 *
 * 🔴 安全模型抄 `src/lib/agent-tools/readonly/types.ts`(诸葛亮/张骞等 4 agent
 * 共用的资源身份强作用域 pattern):这套工具喂给 Claude(黑盒,可幻觉/被
 * prompt 注入)。这个 agent 的越权轴跟 SEO/GA4 那组不一样 —— 不是
 * domain/siteUrl/propertyId,而是 clientId / conversationId / configSlug 三条:
 *   - clientId       —— 查哪个客户的 brief / 哪个客户名下的会话
 *   - conversationId —— 查哪一段对话历史
 *   - configSlug     —— 读哪个客户的 config/clients/<slug>/offerings.yaml
 * 全部由**服务端注入 ctx**(`buildMessengerAgentTools` 冻结进 handler 闭包),
 * 工具 input_schema 一律不暴露这些字段,handler 只用 ctx.* 查询,即便 Claude
 * 在 input 里硬塞了这些字段也被忽略(见 `warnOnResourceIds`)。
 *
 * offerings.yaml 是 Verifier(#1579)判"这个团到底能不能订"的唯一事实源
 * (`offerings-loader.ts` 头注释)——`query_active_tours` / `query_retired_tours`
 * 让 agent 在生成回复**之前**就主动核实,而不是凭训练知识或网站缓存内容
 * 编造团期/价格,这正是这整套治理系统要堵住的那个真实事故(Meta 官方 AI
 * 把已下架的团说成可订)。
 */

import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { getActiveBrief } from '@/lib/content/brief-injector'
import { loadOfferings, type ActiveTour, type RetiredTour } from './offerings-loader'

// ─── ctx + 越权轴守卫(照抄 agent-tools/readonly/types.ts 的 pattern)──────────

/**
 * 三条越权轴全部服务端注入,冻结进 handler 闭包。Claude 全程无法通过工具
 * input 指定查哪个客户 / 哪段对话 / 哪份 offerings 配置。
 */
export interface MessengerAgentToolContext {
  /** 越权轴 1 —— brief / 对话归属校验用 */
  clientId: string
  /** 越权轴 2 —— 查哪一段对话历史 */
  conversationId: string
  /** 越权轴 3 —— `config/clients/<configSlug>/offerings.yaml` 的目录名,不是 DB UUID */
  configSlug: string
  supabase: SupabaseClient
}

/** 一个只读工具 = Anthropic 工具定义 + 绑 ctx 的 handler。 */
export interface MessengerAgentToolModule {
  tool: Anthropic.Tool
  handler: (input: unknown, ctx: MessengerAgentToolContext) => Promise<string>
}

/**
 * 若 Claude 在 input 里硬塞了资源标识符(不该有 —— schema 没声明这些字段),
 * 这些字段被**忽略**(handler 只用 ctx.*)。命中即告警,用于观测越权尝试 /
 * prompt 注入信号。此函数不改 input、不抛错,仅告警 —— 跟
 * `agent-tools/readonly/types.ts` 的 `warnOnResourceIds` 同一约定。
 */
const FORBIDDEN_INPUT_KEYS = [
  'client_id', 'clientId', 'client',
  'conversation_id', 'conversationId', 'conversation',
  'config_slug', 'configSlug',
  // 照抄 readonly 工具集那 4 条轴的字面量,防止有人把这套工具误接到别的
  // 上下文时也一并挡住 —— 这套工具本身不用这几条轴,但挡上不会有副作用。
  'domain', 'target', 'url', 'site_url', 'siteUrl', 'site',
  'property_id', 'propertyId', 'property',
]

export function warnOnResourceIds(input: unknown, toolName: string): void {
  if (!input || typeof input !== 'object') return
  for (const key of Object.keys(input as Record<string, unknown>)) {
    if (FORBIDDEN_INPUT_KEYS.includes(key)) {
      console.warn(
        `[messenger-agent/tools] ${toolName}: ignored resource identifier "${key}" in tool input ` +
        `— using server-injected ctx only (possible prompt-injection or hallucination)`,
      )
    }
  }
}

function truncateToolOutput(s: string, maxChars = 6000): string {
  return s.length <= maxChars ? s : `${s.slice(0, maxChars)}\n…[truncated ${s.length - maxChars} chars]`
}

function optString(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined
}

/** `intent_keywords` 可以是字符串数组,也容错单个字符串(Claude 偶尔会传成单值)。 */
function optStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim())
  }
  const single = optString(raw)
  return single ? [single] : []
}

function matchesAnyKeyword(haystack: string[], keywords: string[]): boolean {
  const lowerHaystack = haystack.map((h) => h.toLowerCase())
  return keywords.some((kw) => {
    const needle = kw.toLowerCase()
    return lowerHaystack.some((h) => h.includes(needle))
  })
}

function activeTourSummary(t: ActiveTour) {
  return {
    code: t.code,
    name: t.name,
    aliases: t.aliases,
    price_nzd: t.price_nzd,
    departure_dates: t.departure_dates,
    nights: t.nights,
    itinerary_url: t.itinerary_url,
    highlights: t.highlights,
  }
}

function retiredTourSummary(t: RetiredTour) {
  return {
    code: t.code,
    name: t.name,
    aliases: t.aliases,
    retired_reason: t.retired_reason,
    still_visible_on_website: t.still_visible_on_website ?? null,
  }
}

// ─── 工具 1 — query_active_tours ─────────────────────────────────────────────

export const queryActiveTours: MessengerAgentToolModule = {
  tool: {
    name: 'query_active_tours',
    description:
      'Look up the canonical, currently-bookable tours from the offerings fact layer ' +
      '(config/clients/<client>/offerings.yaml — the single source of truth for what is ' +
      'actually for sale right now, NOT the website or your training knowledge). Use this ' +
      'BEFORE stating any tour name, price, date, or itinerary to a customer. Optionally ' +
      'filter by keywords extracted from the customer\'s message (matched against tour name, ' +
      'aliases, and highlights). Omit the filter to list every active tour.',
    input_schema: {
      type: 'object',
      properties: {
        intent_keywords: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional keywords from the customer\'s message (e.g. ["Silk Road"], ["Christmas", "China"]) ' +
            'to narrow down which active tours to return. Case-insensitive substring match against ' +
            'tour name / aliases / highlights. Omit to get the full active list.',
        },
      },
    },
  },

  async handler(input, ctx) {
    warnOnResourceIds(input, 'query_active_tours')
    const args = (input ?? {}) as Record<string, unknown>
    const keywords = optStringArray(args.intent_keywords)

    try {
      const offerings = await loadOfferings({ configSlug: ctx.configSlug })
      const tours = keywords.length === 0
        ? offerings.active_tours
        : offerings.active_tours.filter((t) =>
            matchesAnyKeyword([t.name, ...t.aliases, ...t.highlights], keywords),
          )

      return truncateToolOutput(JSON.stringify({
        fact_layer: 'offerings.yaml',
        last_verified_at: offerings.last_verified_at,
        matched_by_keywords: keywords.length > 0 ? keywords : null,
        active_tours: tours.map(activeTourSummary),
      }))
    } catch (err) {
      return JSON.stringify({
        error: `Active tours lookup failed — treat tour availability as UNKNOWN, do not guess: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  },
}

// ─── 工具 2 — query_retired_tours ────────────────────────────────────────────

export const queryRetiredTours: MessengerAgentToolModule = {
  tool: {
    name: 'query_retired_tours',
    description:
      'Look up tours that are RETIRED / no longer for sale (offerings.yaml retired_tours). Use ' +
      'this whenever a customer asks about a tour you cannot find in query_active_tours, or ' +
      'mentions a tour name you are not fully sure is still current — some retired tours\' ' +
      'marketing pages are still live on the website (still_visible_on_website), which is exactly ' +
      'the trap this check exists to catch. If found here, tell the customer it is no longer ' +
      'offered (state retired_reason if useful) and never offer to book it.',
    input_schema: {
      type: 'object',
      properties: {
        name_or_alias: {
          type: 'string',
          description:
            'Optional tour name or alias mentioned by the customer, to check specifically. ' +
            'Case-insensitive substring match against name / aliases. Omit to list every retired tour.',
        },
      },
    },
  },

  async handler(input, ctx) {
    warnOnResourceIds(input, 'query_retired_tours')
    const args = (input ?? {}) as Record<string, unknown>
    const nameOrAlias = optString(args.name_or_alias)

    try {
      const offerings = await loadOfferings({ configSlug: ctx.configSlug })
      const tours = nameOrAlias === undefined
        ? offerings.retired_tours
        : offerings.retired_tours.filter((t) => matchesAnyKeyword([t.name, ...t.aliases], [nameOrAlias]))

      return truncateToolOutput(JSON.stringify({
        fact_layer: 'offerings.yaml',
        last_verified_at: offerings.last_verified_at,
        matched_by: nameOrAlias ?? null,
        retired_tours: tours.map(retiredTourSummary),
      }))
    } catch (err) {
      return JSON.stringify({
        error: `Retired tours lookup failed — treat tour status as UNKNOWN, do not guess: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  },
}

// ─── 工具 3 — query_conversation_history ─────────────────────────────────────

const CONVERSATION_HISTORY_LIMIT = 50

interface ConversationOwnerRow {
  id: string
  client_id: string
}

interface ConversationMessageRow {
  direction: 'inbound' | 'outbound'
  sender_name: string | null
  body: string | null
  sent_at: string
}

export const queryConversationHistory: MessengerAgentToolModule = {
  tool: {
    name: 'query_conversation_history',
    description:
      'Fetch the message history of the CURRENT conversation (the one you are replying in), ' +
      'oldest first, up to the most recent ' + CONVERSATION_HISTORY_LIMIT + ' messages. Use this ' +
      'to understand what has already been said before drafting your reply. Takes no arguments — ' +
      'it always reads the conversation you were invoked for, never any other conversation.',
    input_schema: { type: 'object', properties: {} },
  },

  async handler(input, ctx) {
    warnOnResourceIds(input, 'query_conversation_history')

    try {
      // IDOR 闸(跟 optout.ts / dnc 路由同一条纪律):conversationId 本身是服务端
      // 注入、Claude 无法指定,但仍然要求它属于 ctx.clientId 才放行读取 ——
      // 双 key 过滤,不因为 conversationId 是 UUID 就假设它天然只属于这个客户。
      const { data: convo, error: convErr } = await ctx.supabase
        .from('conversations')
        .select('id, client_id')
        .eq('id', ctx.conversationId)
        .eq('client_id', ctx.clientId)
        .maybeSingle()

      if (convErr) {
        return JSON.stringify({ error: `Conversation lookup failed: ${convErr.message}` })
      }
      if (!(convo as ConversationOwnerRow | null)) {
        return JSON.stringify({ error: 'Conversation not found for this client — refusing to read history.' })
      }

      const { data, error } = await ctx.supabase
        .from('conversation_messages')
        .select('direction, sender_name, body, sent_at')
        .eq('conversation_id', ctx.conversationId)
        .order('sent_at', { ascending: true })
        .limit(CONVERSATION_HISTORY_LIMIT)

      if (error) {
        return JSON.stringify({ error: `Conversation history lookup failed: ${error.message}` })
      }

      const messages = ((data as ConversationMessageRow[] | null) ?? []).map((m) => ({
        direction: m.direction,
        sender_name: m.sender_name,
        body: m.body,
        sent_at: m.sent_at,
      }))

      return truncateToolOutput(JSON.stringify({ conversation_scoped: true, messages }))
    } catch (err) {
      return JSON.stringify({
        error: `Conversation history lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  },
}

// ─── 工具 4 — query_client_brand_facts ───────────────────────────────────────

export const queryClientBrandFacts: MessengerAgentToolModule = {
  tool: {
    name: 'query_client_brand_facts',
    description:
      'Look up THIS client\'s brand voice facts from their active Master Brief (tone, target ' +
      'audience, pain points, words to avoid). Use this to keep your reply on-brand. Scoped to ' +
      'the current client only — does not return tour/pricing facts (use query_active_tours / ' +
      'query_retired_tours for those).',
    input_schema: { type: 'object', properties: {} },
  },

  async handler(input, ctx) {
    warnOnResourceIds(input, 'query_client_brand_facts')

    try {
      // 🔴 clientId is server-injected — this can only ever read this client's own brief.
      const brief = await getActiveBrief(ctx.clientId)
      if (!brief) {
        return JSON.stringify({
          note: 'No active Master Brief found for this client — no brand-voice facts available.',
        })
      }

      return truncateToolOutput(JSON.stringify({
        client_scoped: true,
        brand_name: brief.brand_name ?? null,
        tagline: brief.tagline ?? brief.core_proposition ?? null,
        tone: brief.tone ?? null,
        primary_audience: brief.primary_audience ?? null,
        pain_points: brief.pain_points ?? [],
        buying_trigger: brief.buying_trigger ?? null,
        avoid_words: brief.avoid_words ?? [],
      }))
    } catch (err) {
      return JSON.stringify({
        error: `Brand facts lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  },
}

// ─── 工厂 — buildMessengerAgentTools ──────────────────────────────────────────

const MODULES: MessengerAgentToolModule[] = [
  queryActiveTours,
  queryRetiredTours,
  queryConversationHistory,
  queryClientBrandFacts,
]

export interface BuildMessengerAgentToolsInput {
  clientId: string
  conversationId: string
  configSlug: string
  supabase?: SupabaseClient
}

/**
 * Build the 4-tool set for one conversation. `ctx` is captured in closure —
 * Claude cannot influence clientId / conversationId / configSlug through any
 * tool input, matching `agent-tools/readonly/index.ts`'s `buildReadonlyTools`.
 */
export function buildMessengerAgentTools(base: BuildMessengerAgentToolsInput): {
  tools: Anthropic.Tool[]
  handlers: Record<string, (input: unknown) => Promise<string>>
} {
  const ctx: MessengerAgentToolContext = {
    clientId: base.clientId,
    conversationId: base.conversationId,
    configSlug: base.configSlug,
    supabase: base.supabase ?? supabaseAdmin,
  }

  const tools = MODULES.map((m) => m.tool)
  const handlers: Record<string, (input: unknown) => Promise<string>> = {}
  for (const m of MODULES) {
    handlers[m.tool.name] = (input: unknown) => m.handler(input, ctx)
  }
  return { tools, handlers }
}
