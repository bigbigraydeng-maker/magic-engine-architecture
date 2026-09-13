/**
 * CTS Governed Reply Agent — system prompt assembly (Issue #1580).
 *
 * 组装喂给 `callClaudeWithTools`(`src/lib/anthropic/client.ts`)的 system prompt:
 * brief(品牌语气)+ canonical 团清单事实(offerings.yaml,已经是这次调用时刻
 * 读到的快照)+ 对话历史(调用方已经取好的最近几轮)+ 硬闸文案(输出契约 +
 * 绝不能做的事)。
 *
 * 为什么 canonical 事实已经写进 prompt 了,`tools.ts` 还要再给一遍
 * `query_active_tours` / `query_retired_tours`:这里写进去的是**这一刻的快照**,
 * 只用来让 Claude 一眼看到"大概有哪些团"，降低多余的工具调用；但 Verifier
 * (#1579)的 provenance 闸门只认工具调用轨迹,不认"prompt 里写过"——回复里
 * 提到的每个团都必须能对应到一次真实的 `query_active_tours` /
 * `query_retired_tours` 调用结果,而不是 Claude 凭 prompt 里的文字自己拼出来的。
 * 硬闸文案里因此明确要求:提到具体团之前必须先调用对应工具核实。
 *
 * 这个模块是纯函数(不碰数据库/网络)——所有材料由调用方(F1 Inngest 函数,
 * 未来 issue 落地)先各自取好再传进来,方便单测,也让"取数据"和"拼文案"
 * 两件事解耦。
 */

import type { MasterBrief } from '@/types/magic-engine'
import { formatBriefForPrompt } from '@/lib/content/brief-injector'
import type { OfferingsFile } from './offerings-loader'

export interface ConversationHistoryTurn {
  direction: 'inbound' | 'outbound'
  senderName: string | null
  body: string | null
  sentAt: string
}

export interface BuildMessengerAgentSystemPromptInput {
  /** 该客户当前生效的 Master Brief;没有则明确告诉 Claude 不要编造品牌信息。 */
  brief: MasterBrief | null
  /** `loadOfferings({ configSlug })` 读到的这一刻快照。 */
  offerings: OfferingsFile
  /** 调用方已经取好的最近几轮对话,时间正序(最老的在前)。 */
  conversationHistory: ConversationHistoryTurn[]
}

function formatOfferingsSnapshot(offerings: OfferingsFile): string {
  const activeLines = offerings.active_tours.length === 0
    ? '  (目前没有任何在售团 —— 不要向客户推荐任何具体团)'
    : offerings.active_tours
        .map((t) => `  - [${t.code}] ${t.name} —— NZ$${t.price_nzd}，${t.nights} 晚，出发日期：${t.departure_dates.join(' / ')}`)
        .join('\n')

  const retiredLines = offerings.retired_tours.length === 0
    ? '  (目前没有已知的下架团记录)'
    : offerings.retired_tours
        .map((t) => `  - [${t.code}] ${t.name} —— 下架原因：${t.retired_reason}${t.still_visible_on_website ? '（⚠️ 官网页面仍在线，客户可能会问起）' : ''}`)
        .join('\n')

  const bullets = offerings.factual_bullets.length === 0
    ? '  (无)'
    : offerings.factual_bullets.map((b) => `  - ${b}`).join('\n')

  const forbidden = offerings.reply_forbidden_topics.length === 0
    ? '  (无)'
    : offerings.reply_forbidden_topics.map((t) => `  - ${t}`).join('\n')

  return `事实层快照(offerings.yaml，最后核实时间：${offerings.last_verified_at}):

在售团（canonical，可以推荐/报价/给出行程链接）：
${activeLines}

已下架团（绝不能说成可订，问起时要明确说明已下架）：
${retiredLines}

可直接陈述的硬事实：
${bullets}

禁止直接作答的话题（应礼貌说明会有人工跟进，不要自己回答）：
${forbidden}`
}

function formatConversationHistory(history: ConversationHistoryTurn[]): string {
  if (history.length === 0) {
    return '（这是这段对话目前已知的第一条消息，没有更早的历史。）'
  }
  return history
    .map((m) => {
      const who = m.direction === 'inbound' ? '客户' : 'CTS'
      const name = m.senderName ? `（${m.senderName}）` : ''
      return `[${m.sentAt}] ${who}${name}: ${m.body ?? '(空消息)'}`
    })
    .join('\n')
}

const HARD_GATE_TEXT = `硬性规则（不可违反）：

1. 在回复里提到任何具体团名 / 价格 / 团期 / 行程链接之前，必须先调用
   \`query_active_tours\` 核实它确实在售。只凭上面的事实层快照或你自己的记忆
   直接下结论 = 违规，因为快照可能在这次对话过程中已经过期，Verifier 只认
   真实的工具调用记录，不认 prompt 里写过什么。
2. 如果客户问起的团不在 \`query_active_tours\` 的结果里，必须调用
   \`query_retired_tours\` 确认——命中就明确告诉客户这个团已经不再销售，绝不能
   说它可订、绝不能报价或给出行程链接，即使官网页面看起来还在线。
3. 绝不能编造、猜测、或用"大概"这类模糊说法陈述价格、团期、行程细节——
   要么有事实层数据支撑，要么明确告诉客户这个问题需要人工确认。
4. 遇到"禁止直接作答的话题"清单里的内容，礼貌说明会有人工同事跟进，不要自己
   给出实质性答案。
5. 输出必须严格符合以下 JSON 契约（不要输出任何 JSON 之外的文字）：
   { "reply_text": string, "confidence": number（0 到 1 之间，代表这条回复可以
   直接发送、不需要人工介入的把握）, "offerings": [{ "name": string, "code": string }] }
   \`offerings\` 是 reply_text 里提到的每一个具体团，按 {name, code} 一一配对——
   name 用你回复里实际写的团名，code 必须是工具返回结果里那个团的 canonical
   code。没有提到任何具体团时 \`offerings\` 传空数组 \`[]\`，不要省略这个字段。
6. 对自己没有把握回答好、或者需要人工判断的问题（例如投诉、退款、超出上面
   事实层范围的追问），把 \`confidence\` 调低，而不是硬答一个听起来合理但没有
   事实支撑的回复。`

export function buildMessengerAgentSystemPrompt(input: BuildMessengerAgentSystemPromptInput): string {
  const briefSection = input.brief
    ? formatBriefForPrompt(input.brief)
    : '（未找到该客户当前生效的 Master Brief——不要编造任何品牌语气/定位信息，只使用下方事实层快照和工具查询结果作答。）'

  return [
    '你是 CTS Tours NZ 的 Messenger 客服回复助手。',
    briefSection,
    formatOfferingsSnapshot(input.offerings),
    `最近的对话历史：\n${formatConversationHistory(input.conversationHistory)}`,
    HARD_GATE_TEXT,
  ].join('\n\n')
}
