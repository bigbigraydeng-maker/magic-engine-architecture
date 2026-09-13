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

interface MessageRow {
  body: string | null
  sent_at: string
}

function containsPostSaleKeyword(body: string | null): boolean {
  if (!body) return false
  const lower = body.toLowerCase()
  return POST_SALE_KEYWORDS.some((kw) => lower.includes(kw))
}

/**
 * 判断一段对话是「售前留资」还是「售后」。
 *
 * 查不到消息（比如 conversationId 传错，或者对话还没同步进消息）时保守判
 * `lead_intake` —— 没有证据说明它是售后，不能替它升级成「跳过自动回复」
 * 之外更重的分支。
 */
export async function classifyConversation(conversationId: string): Promise<ConversationClass> {
  const { data, error } = await supabaseAdmin
    .from('conversation_messages')
    .select('body, sent_at')
    .eq('conversation_id', conversationId)
    .order('sent_at', { ascending: true })

  if (error) {
    throw new Error(`classifyConversation: 读 conversation_messages 失败 — ${error.message}`)
  }

  const messages = (data ?? []) as MessageRow[]
  if (messages.length === 0) return 'lead_intake'

  if (messages.some((m) => containsPostSaleKeyword(m.body))) return 'post_sale'

  const firstAt = new Date(messages[0].sent_at).getTime()
  const lastAt = new Date(messages[messages.length - 1].sent_at).getTime()
  if (lastAt - firstAt > POST_SALE_SPAN_MS) return 'post_sale'

  return 'lead_intake'
}
