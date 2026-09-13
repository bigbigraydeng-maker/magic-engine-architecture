/**
 * 售前留资 vs 售后 —— 一段对话属于哪一类，Messenger 和 WhatsApp 共用这一个判据。
 *
 * ## 为什么要抽出来
 *
 * 3 审第 1 轮子牙 B1 blocker（v3 方案 `~/.claude/plans/cts-tours-messenger-dynamic-pearl.md`）：
 * 原设计是 F2（WhatsApp 那条线）靠「等 F1（Messenger）发完事件」来判断「这段对话
 * 要不要继续走自动回复」，会跟 opt-out 检查互相卡死。改成 F1/F2 各自独立调用
 * 这同一个纯函数，谁也不等谁。
 *
 * `conversation_messages` 表 Messenger / WhatsApp 两个渠道共用（见
 * `src/lib/messaging/adapters/messenger.ts` 和 `whatsapp.ts` 里对同一张表的读法），
 * 所以这里**不需要按渠道分支** —— 只读 `body` / `sent_at`，不认渠道。
 *
 * ## 判据（issue #1576，不做穷尽）
 *
 * 命中任一条即判 `post_sale`：
 *   1. 历史消息（不分收发方向）里出现售后关键词（"booking" / "我订的" / "我已付" 等）
 *   2. 对话跨度（第一条消息到最后一条消息的时间差）**严格大于** 30 天
 *      —— 卡在 30 天整不算，30 天零 1 秒才算（见本文件测试的边界用例）
 *
 * 否则判 `lead_intake`。
 *
 * 关键词清单目前是「已知案例」而非穷尽列表 —— 像"我已经付了定金"这类模糊表达
 * 能不能识别，issue #1576 明确排除在这次范围外，留到 dry-run 阶段用真实对话
 * 验证覆盖率之后再迭代关键词。
 *
 * ## 为什么不整段拉取消息（3 审第 1 轮 Codex P2）
 *
 * 单个对话消息数一旦超过 PostgREST 的 `max-rows`（默认 1,000），不分页的
 * `select` 只会拿到按时间排好序的前一批，后面的售后关键词和真正的最后一条
 * 消息时间都会被漏掉 —— 长对话可能被误判成 `lead_intake` 继续自动回复。
 * 改成三条服务端查询各自独立完成判断：关键词命中用 `.or()` 交给数据库端过滤
 * 只取 1 行判断存在性，首尾消息时间各自 `order + limit(1)` 单独取，
 * 都不依赖把全部消息搬到内存。
 */

import { supabaseAdmin } from '@/lib/supabase'

export type ConversationClass = 'lead_intake' | 'post_sale'

/** 严格大于这个跨度才算「售后」——卡在整 30 天不算。 */
const POST_SALE_SPAN_MS = 30 * 24 * 60 * 60 * 1000

/**
 * 售后特征关键词，中英文都认（客人用哪种语言取决于他自己，不取决于渠道）。
 * 全部小写，匹配时把消息正文也转小写再比对。
 */
const POST_SALE_KEYWORDS = ['booking', '我订的', '我已付', 'receipt', '我下单了']

interface EdgeMessageRow {
  sent_at: string
}

/** 关键词命中判断交给数据库端做（`.or()` + `ilike`），这里只拼过滤表达式。 */
function buildKeywordOrFilter(): string {
  return POST_SALE_KEYWORDS.map((kw) => `body.ilike.%${kw}%`).join(',')
}

/** 只问「存在不存在」，`limit(1)` 保证不管命中多少行都只搬 1 行回来。 */
async function hasPostSaleKeyword(conversationId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('conversation_messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .or(buildKeywordOrFilter())
    .limit(1)

  if (error) {
    throw new Error(`classifyConversation: 关键词查询失败 — ${error.message}`)
  }
  return (data ?? []).length > 0
}

/** 只要对话的第一条 / 最后一条消息时间，各自 `order + limit(1)`，不搬中间的消息。 */
async function fetchEdgeMessage(
  conversationId: string,
  ascending: boolean
): Promise<EdgeMessageRow | null> {
  const { data, error } = await supabaseAdmin
    .from('conversation_messages')
    .select('sent_at')
    .eq('conversation_id', conversationId)
    .order('sent_at', { ascending })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(`classifyConversation: 读 conversation_messages 失败 — ${error.message}`)
  }
  return data
}

/**
 * 判断一段对话是「售前留资」还是「售后」。
 *
 * 查不到消息（比如 conversationId 传错，或者对话还没同步进消息）时保守判
 * `lead_intake` —— 没有证据说明它是售后，不能替它升级成「跳过自动回复」
 * 之外更重的分支。
 */
export async function classifyConversation(conversationId: string): Promise<ConversationClass> {
  if (await hasPostSaleKeyword(conversationId)) return 'post_sale'

  const [firstMessage, lastMessage] = await Promise.all([
    fetchEdgeMessage(conversationId, true),
    fetchEdgeMessage(conversationId, false),
  ])

  if (!firstMessage || !lastMessage) return 'lead_intake'

  const firstAt = new Date(firstMessage.sent_at).getTime()
  const lastAt = new Date(lastMessage.sent_at).getTime()
  if (lastAt - firstAt > POST_SALE_SPAN_MS) return 'post_sale'

  return 'lead_intake'
}
