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
 * ## 两处 Codex 复审修正（PR #1621 review，落地前已修）
 *
 * 1. **默认关键词/跨度不是全平台硬编码**：`DEFAULT_POST_SALE_KEYWORDS`/
 *    `DEFAULT_POST_SALE_SPAN_MS` 只是 CTS（旅游行业）今天的默认值 —— 换一个
 *    地产/专业服务客户，客户发"I'd like to make a booking for an appraisal"
 *    这类售前咨询会被 `booking` 关键词误判成 `post_sale`，跳过本该走的留资
 *    流程（换客户测试反例，见 me-platform-tier-gate 红线 4）。调用方可以传
 *    `options.postSaleKeywords`/`options.postSaleSpanMs` 覆盖，不传就是 CTS
 *    默认值 —— 不是要现在就建 Client Configuration 加载层，只是不把这份
 *    CTS 专属判据焊死成没有覆盖点的全局唯一实现。
 * 2. **分页读消息，不依赖 PostgREST 默认 max-rows**：原实现一次性
 *    `select().order()` 不带 `.range()`，对话消息数一旦超过 PostgREST 的默认
 *    单次上限（常见配置 1000 行），只会拿到按时间排序的前一批，后面的售后
 *    关键词扫不到、`lastAt` 也不是真正的最后一条 —— 可能把本该判 `post_sale`
 *    的长对话误判成 `lead_intake` 并继续自动回复。现在用 `.range()` 分页
 *    取全，用的是数值型 offset（不是拼接查询字符串），不引入 PostgREST 过滤器
 *    转义问题。
 */

import { supabaseAdmin } from '@/lib/supabase'

export type ConversationClass = 'lead_intake' | 'post_sale'

/** 严格大于这个跨度才算「售后」——卡在整 30 天不算。CTS 默认值,可被覆盖。 */
const DEFAULT_POST_SALE_SPAN_MS = 30 * 24 * 60 * 60 * 1000

/**
 * 售后特征关键词，中英文都认（客人用哪种语言取决于他自己，不取决于渠道）。
 * 全部小写，匹配时把消息正文也转小写再比对。CTS（旅游行业）默认值,可被覆盖 ——
 * 见文件头注释「两处 Codex 复审修正」第 1 条。
 */
const DEFAULT_POST_SALE_KEYWORDS = ['booking', '我订的', '我已付', 'receipt', '我下单了']

/** 单次分页拉取的行数,远低于 PostgREST 常见的默认单次上限,留出安全余量。 */
const PAGE_SIZE = 500

export interface ClassifyConversationOptions {
  /** 不传则用 CTS 默认值（见 DEFAULT_POST_SALE_KEYWORDS）。 */
  postSaleKeywords?: readonly string[]
  /** 不传则用 CTS 默认值（30 天，见 DEFAULT_POST_SALE_SPAN_MS）。 */
  postSaleSpanMs?: number
}

interface MessageRow {
  body: string | null
  sent_at: string
}

function containsPostSaleKeyword(body: string | null, keywords: readonly string[]): boolean {
  if (!body) return false
  const lower = body.toLowerCase()
  return keywords.some((kw) => lower.includes(kw.toLowerCase()))
}

/**
 * 分页取出一段对话的全部消息，不依赖 PostgREST 单次查询的默认行数上限。
 * 用数值 offset（`.range()`），不拼接任何查询过滤字符串。
 */
async function fetchAllMessages(conversationId: string): Promise<MessageRow[]> {
  const messages: MessageRow[] = []
  let from = 0

  for (;;) {
    const to = from + PAGE_SIZE - 1
    const { data, error } = await supabaseAdmin
      .from('conversation_messages')
      .select('body, sent_at')
      .eq('conversation_id', conversationId)
      .order('sent_at', { ascending: true })
      .range(from, to)

    if (error) {
      throw new Error(`classifyConversation: 读 conversation_messages 失败 — ${error.message}`)
    }

    const page = (data ?? []) as MessageRow[]
    messages.push(...page)
    if (page.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  return messages
}

/**
 * 判断一段对话是「售前留资」还是「售后」。
 *
 * 查不到消息（比如 conversationId 传错，或者对话还没同步进消息）时保守判
 * `lead_intake` —— 没有证据说明它是售后，不能替它升级成「跳过自动回复」
 * 之外更重的分支。
 */
export async function classifyConversation(
  conversationId: string,
  options: ClassifyConversationOptions = {},
): Promise<ConversationClass> {
  const keywords = options.postSaleKeywords ?? DEFAULT_POST_SALE_KEYWORDS
  const spanMs = options.postSaleSpanMs ?? DEFAULT_POST_SALE_SPAN_MS

  const messages = await fetchAllMessages(conversationId)
  if (messages.length === 0) return 'lead_intake'

  if (messages.some((m) => containsPostSaleKeyword(m.body, keywords))) return 'post_sale'

  const firstAt = new Date(messages[0].sent_at).getTime()
  const lastAt = new Date(messages[messages.length - 1].sent_at).getTime()
  if (lastAt - firstAt > spanMs) return 'post_sale'

  return 'lead_intake'
}
