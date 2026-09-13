/**
 * 售前留资 vs 售后 —— 一段对话属于哪一类，Messenger 和 WhatsApp 共用这一段查询逻辑，
 * 但判据本身按行业/客户注入，不在这个共享函数里写死。
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
 * ## 判据不写死在共享函数里（Codex 复审 P1）
 *
 * "booking" / 30 天这类判据只对旅游场景成立 —— 地产客户收到「我想约一个 appraisal
 * booking」这种售前留资消息，一样会命中 "booking"。这些判据必须由调用方通过
 * `PostSaleClassificationPolicy` 显式传入，共享函数本身不带任何行业默认值。
 * 旅游行业（issue #1576，CTS Tours 等）的具体判据放在下面的 `TOURISM_POST_SALE_POLICY`，
 * 作为一个具名、需要显式 import 才会生效的 Playbook 级常量，不是这个模块的隐式默认。
 *
 * 命中任一条即判 `post_sale`：
 *   1. 历史消息（不分收发方向）里出现 `policy.postSaleKeywords` 里的关键词
 *   2. 对话跨度（第一条消息到最后一条消息的时间差）**严格大于** `policy.postSaleSpanMs`
 *      —— 卡在整数分界不算，多 1 毫秒才算（见本文件测试的边界用例）
 *
 * 否则判 `lead_intake`。
 *
 * `TOURISM_POST_SALE_POLICY` 里的关键词清单目前是「已知案例」而非穷尽列表 —— 像
 * "我已经付了定金"这类模糊表达能不能识别，issue #1576 明确排除在这次范围外，
 * 留到 dry-run 阶段用真实对话验证覆盖率之后再迭代关键词。
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

/** 售后判据 —— 由调用方（Playbook / Profile / Configuration）显式传入，没有平台级默认值。 */
export interface PostSaleClassificationPolicy {
  /** 命中任一关键词（大小写不敏感，匹配前正文和关键词都转小写）即判 `post_sale`。 */
  postSaleKeywords: string[]
  /** 对话跨度严格大于这个毫秒数才判 `post_sale` —— 卡在整数分界不算。 */
  postSaleSpanMs: number
}

/**
 * 旅游行业（issue #1576，CTS Tours 等）的售后判据。这是行业特定 Playbook 常量，
 * 不是 `classifyConversation` 的隐式默认值 —— 其它行业（地产、专业服务等）
 * "booking" 一类词可能正是售前留资场景，必须由各自的 Playbook 提供自己的 policy，
 * 不能沿用这份旅游关键词清单。
 */
export const TOURISM_POST_SALE_POLICY: PostSaleClassificationPolicy = {
  postSaleKeywords: ['booking', '我订的', '我已付', 'receipt', '我下单了'],
  postSaleSpanMs: 30 * 24 * 60 * 60 * 1000,
}

interface EdgeMessageRow {
  sent_at: string
}

/** 关键词命中判断交给数据库端做（`.or()` + `ilike`），这里只拼过滤表达式。 */
function buildKeywordOrFilter(keywords: string[]): string {
  return keywords.map((kw) => `body.ilike.%${kw}%`).join(',')
}

/** 只问「存在不存在」，`limit(1)` 保证不管命中多少行都只搬 1 行回来。 */
async function hasPostSaleKeyword(conversationId: string, keywords: string[]): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('conversation_messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .or(buildKeywordOrFilter(keywords))
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
 * `policy` 必须由调用方显式传入（例如旅游场景传 `TOURISM_POST_SALE_POLICY`）——
 * 这个函数本身不内置任何行业判据，避免旅游关键词悄悄套到其它行业客户身上。
 *
 * 查不到消息（比如 conversationId 传错，或者对话还没同步进消息）时保守判
 * `lead_intake` —— 没有证据说明它是售后，不能替它升级成「跳过自动回复」
 * 之外更重的分支。
 */
export async function classifyConversation(
  conversationId: string,
  policy: PostSaleClassificationPolicy
): Promise<ConversationClass> {
  if (await hasPostSaleKeyword(conversationId, policy.postSaleKeywords)) return 'post_sale'

  const [firstMessage, lastMessage] = await Promise.all([
    fetchEdgeMessage(conversationId, true),
    fetchEdgeMessage(conversationId, false),
  ])

  if (!firstMessage || !lastMessage) return 'lead_intake'

  const firstAt = new Date(firstMessage.sent_at).getTime()
  const lastAt = new Date(lastMessage.sent_at).getTime()
  if (lastAt - firstAt > policy.postSaleSpanMs) return 'post_sale'

  return 'lead_intake'
}
