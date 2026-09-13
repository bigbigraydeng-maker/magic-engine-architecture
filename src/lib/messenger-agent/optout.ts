/**
 * 跨渠道退订检测 —— CTS Governed Reply Agent 用它决定「这条会话还能不能回」。
 *
 * issue #1575：v3 对 v2 的唯一 blocker（F1 没查拉黑）的正式解法，也是三审第 1 轮
 * 被打回重设计过一次的部分。第一版设计过 `conversations.opted_out`，被指出
 * **换渠道就失效、也没有撤销路径** —— 客人在 Messenger 上说了「退订」，
 * 那一列只挡得住 Messenger，WhatsApp 照样会发；而一旦标错，系统里没有任何
 * 入口能把人放回来。
 *
 * 这里**不新建判断逻辑**：判据只有一份 —— `lib/crm/dnc.ts` 的
 * `isDoNotContact()`，全仓统一用它判「这个人还能不能联系」，跟销售手打备注、
 * 私信提醒走的是同一份材料（`contact_touchpoints`）。撤销也是**零新代码**：
 * 直接复用已存在的 `/api/clients/[id]/crm/contacts/[cid]/dnc` 纠正路由 ——
 * 那条路由已经把「先写触点、后放列、两步都要成」焊死了，这里不重复。
 *
 * ## 有 contact_id / 没有 contact_id，两条完全不同的路
 *
 * 大多数会话在建立时就通过 `resolveContact()`（`lib/crm/identity.ts`）挂上了
 * 真人 —— 这时退订状态**跨渠道**：同一个人在 Messenger 说过退订，WhatsApp 那边
 * 也会读到同一份触点，不看渠道。这正是这次换底座换来的核心能力（v3 vs v2）。
 *
 * 但少数会话挂不上人（该渠道身份还合并不到任何人，比如只在 FB 聊过、从没留过
 * 电话邮箱）—— 这时没有 `contacts` 行可查，只能退回查这条会话自己的
 * `conversations.optout_unlinked` 兜底列（issue #1574 新增，**不经过任何缓存**，
 * 直查这一条会话，因为它天生就是会话级、不是人级的判断）。
 *
 * ## IDOR 闸：`client_id` 只认会话自己带的，不接受外部传入
 *
 * `isConversationOptedOut` 只收 `conversationId` 一个参数 —— 调用方给不出、
 * 也不该给 `client_id`。查 `contacts` / `contact_touchpoints` 时用的
 * `client_id` 永远是**从这条会话本身查出来的那一个**，且查询同时按
 * `contact_id` 和这个 `client_id` 过滤（跟 `dnc` 路由的 IDOR 闸同一个写法）。
 * 少了这道过滤，理论上可能因为查询拼装错误而读到别的客户名下同一个 UUID
 * 撞出来的行 —— 虽然 `contact_id` 是全局唯一的外键，但「同时按两个键过滤」
 * 是这个仓库对触点类查询的统一纪律，不因为这里看似用不上就省掉。
 *
 * ## 出错时宁可拦一条，不放过一条
 *
 * 查会话 / 查 contact / 查触点任何一步失败，都当作「退订」处理（返回 true，
 * 拦下这条回复）而不是当「没退订」放行。这是「对外发消息」这类有副作用的
 * 判断该有的方向（CLAUDE.md 铁律「发布…必须 fail-closed」）—— 少发一条消息，
 * 代价远小于给一个已经明确说过别再联系的人发消息。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { isDoNotContact, dncClearedAt, type DncTouch } from '@/lib/crm/dnc'

// ---------------------------------------------------------------------------
// 1) 关键词检测 —— 纯函数，不碰数据库。
// ---------------------------------------------------------------------------

/**
 * 中英双语退订关键词，SMS 行业的老规矩：整条消息就是这个词（允许两边带标点/
 * 空白），不是「消息里出现了这个词」。
 *
 * 为什么不做子串匹配：`STOP`/`stop` 这类词一旦允许出现在句子中间，
 * 「please don't stop the tour」「can you stop by our hotel」这种正常问句
 * 全部会被误判成退订 —— 那是比「漏判一条」更糟的事故（活人被系统静默拉黑，
 * 且没有人知道为什么，直到对方投诉「你们怎么不理我了」）。SMS 行业早就用
 * 整条消息匹配解决了这个问题（Twilio 的 STOP/UNSUBSCRIBE/CANCEL/END/QUIT
 * 关键词表就是整条消息比对），这里跟随同一个约定。
 */
const OPT_OUT_KEYWORDS_EN = new Set(['stop', 'unsubscribe'])
const OPT_OUT_KEYWORDS_ZH = new Set(['退订', '取消关注'])

/** 两边的标点/空白都不算数：「STOP.」「退订!」「  stop  」都要认出来。 */
function normalizeForKeywordMatch(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/^[\s.,!?~。，！？～、]+|[\s.,!?~。，！？～、]+$/g, '')
}

/**
 * 这句话是不是一条退订指令。中英双语、大小写不敏感，整条消息匹配
 * （见上方注释——不是子串匹配）。
 */
export function isOptOutKeyword(text: string): boolean {
  if (typeof text !== 'string') return false
  const normalized = normalizeForKeywordMatch(text)
  if (!normalized) return false
  return OPT_OUT_KEYWORDS_EN.has(normalized) || OPT_OUT_KEYWORDS_ZH.has(normalized)
}

// ---------------------------------------------------------------------------
// 2) 跨渠道退订判定 —— 有 I/O，可注入 supabase client 供测试用假数据源。
// ---------------------------------------------------------------------------

interface ConversationRow {
  id: string
  client_id: string
  contact_id: string | null
  /**
   * issue #1574 新增列（本 PR 提交时尚未合并主分支）。**假设它存在**，
   * 但任何依赖它真实存在于数据库里的测试都不许在本 PR 里真跑
   * ——见 PR 描述。
   */
  optout_unlinked: boolean | null
}

interface ContactRow {
  do_not_contact: boolean | null
}

interface TouchpointRow {
  occurred_at: string
  metadata: Record<string, unknown> | null
}

/**
 * 这条会话现在算不算「退订了」。
 *
 * @param conversationId 会话 id（`conversations.id`）。
 * @param supabase 默认生产客户端；测试注入假数据源（跟
 *   `lib/crm/messenger-stop-signal.ts` 的 `findMessengerStopSignals` 同一个
 *   可测试写法）。
 */
export async function isConversationOptedOut(
  conversationId: string,
  supabase: SupabaseClient = supabaseAdmin,
): Promise<boolean> {
  const { data: convo, error: convErr } = await supabase
    .from('conversations')
    .select('id, client_id, contact_id, optout_unlinked')
    .eq('id', conversationId)
    .maybeSingle()

  if (convErr) {
    console.error(`[messenger-agent/optout] 查会话失败 conversationId=${conversationId}:`, convErr.message)
    return true // fail-closed：查不出来就当拦下处理，见文件头注释。
  }
  if (!convo) {
    // 会话都不存在：没有「该不该回」这回事，但也不能装作「能回」。
    console.error(`[messenger-agent/optout] 会话不存在 conversationId=${conversationId}`)
    return true
  }

  const row = convo as ConversationRow
  const contactId = row.contact_id

  if (!contactId) {
    // 挂不上人的会话：退回这条会话自己的兜底列，不经过任何缓存。
    return row.optout_unlinked === true
  }

  // Codex 复审（PR #1625，第 2 轮）：会话先在挂不上人的阶段命中过关键词、
  // 写了 optout_unlinked=true，之后身份解析补上了 contact_id（见
  // link-contacts.ts 会给原先为空的会话回填 contact_id）——如果这里只看
  // contact 一侧，新联系人大概率还没有任何 DNC 触点，会直接判「没退订」，
  // 一个已经明确表示过退订的人反而被放行。optout_unlinked 一旦立起来，
  // 不会因为后来补上了 contact_id 就失效，两个信号是「或」的关系。
  if (row.optout_unlinked === true) return true

  // IDOR 闸：contact / 触点查询必须同时按 contact_id 和「这条会话自己的」
  // client_id 过滤 —— 不接受任何外部传入的 client_id（本函数压根不收这个参数）。
  const clientId = row.client_id

  const [contactResult, touchResult] = await Promise.all([
    supabase
      .from('contacts')
      .select('do_not_contact')
      .eq('id', contactId)
      .eq('client_id', clientId)
      .maybeSingle(),
    supabase
      .from('contact_touchpoints')
      .select('occurred_at, metadata')
      .eq('contact_id', contactId)
      .eq('client_id', clientId),
  ])

  if (contactResult.error) {
    console.error(
      `[messenger-agent/optout] 查 contact 失败 contactId=${contactId}:`,
      contactResult.error.message,
    )
    return true
  }
  if (touchResult.error) {
    console.error(
      `[messenger-agent/optout] 查触点失败 contactId=${contactId}:`,
      touchResult.error.message,
    )
    return true
  }
  if (!contactResult.data) {
    // contactId 有值，但按「同一个 client_id」过滤后查不到这一行 ——
    // 要么这条会话的 contact_id 挂错了客户（外键只约束 contacts(id) 存在，
    // 不约束同一个 client_id），要么数据本身就是坏的。这已经是异常状态，
    // 不能把「查不到」悄悄当成「没被标 DNC」放行，同样按 fail-closed 处理。
    console.error(
      `[messenger-agent/optout] contact 不属于会话的 client_id contactId=${contactId} clientId=${clientId}`,
    )
    return true
  }

  const contactFlag = (contactResult.data as ContactRow).do_not_contact === true
  const touches: DncTouch[] = ((touchResult.data as TouchpointRow[] | null) ?? []).map((t) => {
    const meta = t.metadata ?? {}
    return {
      outcome: (meta.outcome as string | undefined) ?? null,
      flagged: meta.do_not_contact === true,
      occurredAt: t.occurred_at,
    }
  })

  // 判据只有一份：lib/crm/dnc.ts。不在这里重新发明「怎么判 DNC」。
  return isDoNotContact(contactFlag, touches)
}

// ---------------------------------------------------------------------------
// 3) 关键词命中后写一条触点 —— 复用既有表结构，不新建字段、不新建判断逻辑。
// ---------------------------------------------------------------------------

export interface RecordOptOutKeywordTouchInput {
  clientId: string
  contactId: string
  /** `contact_touchpoints.channel` 的 CHECK 约束子集——这个模块只处理这两条渠道。 */
  channel: 'messenger' | 'whatsapp'
  conversationId: string
  messageId: string
  /**
   * 必须是这条消息（触发退订关键词判定的那条客户消息）真实的发送时间，
   * 不能省略、更不能用调用时刻的「现在」代替（Codex 复审 PR #1625 第 2 轮
   * 指出的问题）：本函数下面的重放保护要拿它跟 `dncClearedAt()` 比大小，
   * 如果每次重试都重算成当前时间，一条本该被识别成「旧 webhook 重放」的
   * 事件，时间戳会永远晚于任何人工纠正，保护形同虚设。调用方从 webhook
   * payload 或 `conversation_messages.sent_at` 取真实值传进来。
   */
  occurredAt: string
}

export interface RecordOptOutKeywordTouchResult {
  touchpointId: string | null
}

/**
 * 客人这条消息命中了退订关键词 —— 写一条触点，让 `lib/crm/dnc.ts` 的判据
 * **跨渠道**立刻看到它，并同步反规范化镜像列 `contacts.do_not_contact`。
 *
 * 字段形状是 issue #1575 钉死的：`outcome` 必须在 `metadata` 里，
 * 不是顶层列 —— `contact_touchpoints` 表压根没有顶层 `outcome` 列
 * （见 `supabase/migrations/20260726000005_contact_touchpoints.sql`），
 * 照字面写顶层字段会插入失败。
 *
 * 幂等键用 `${conversationId}:optout:${messageId}` —— Meta 的 webhook
 * 是至少一次投递，同一条消息重复到达不能记成两笔触点。
 *
 * 写法跟 `lib/crm/touchpoints.ts` 的 `recordManualTouchpoint()` 一致：
 * 先幂等写触点，镜像列的更新**默认执行**（哪怕触点命中幂等键没有真插），
 * 让「首次镜像更新失败」这种情况靠同一个幂等键重试收敛 ——跟
 * `recordManualTouchpoint` 的约定相同，这里不重复处理「报警但不阻断」
 * 这类调用方策略。
 *
 * 唯一的例外：Meta 的 webhook 是至少一次投递，一条很旧的退订消息可能在
 * 人已经走 `/dnc` 纠正（`dnc_cleared`，见 `lib/crm/dnc.ts`）之后才重放到达。
 * 这时触点真相已经以那次更晚的人工纠正为准，这里**不能**无条件把镜像列
 * 覆盖回 `true`——那会让 `/dnc` 刚做完的纠正在下一次 webhook 重试时被
 * 悄悄推翻，且没有任何报错提示。所以写镜像列之前会看一眼这个联系人
 * 现在最新的 `dnc_cleared` 时间点：晚于这条事件本身的时间戳，就跳过覆盖。
 *
 * ## 已知但不在本次修的限制：先查后写不是原子操作（Codex 复审 PR #1625 第 2 轮）
 *
 * 「查有没有更晚的人工纠正」和「写镜像列」中间没有加锁/事务——理论上人工走
 * `/dnc` 清除可以恰好插在这两步之间，让这次更新仍然把镜像列写回 `true`，
 * 覆盖掉刚清除的结果。触点这份真相源本身不受影响（`isDoNotContact()` 永远
 * 读得到那条更晚的 `dnc_cleared`，判断依旧正确），受影响的只是**直接读
 * 镜像列、不走 `isDoNotContact()` 判据的少数消费方**。这个窗口极窄（需要
 * 人工纠正精确插进两次数据库往返之间），修好需要一次 DB 端条件更新
 * （RPC/存储过程或事务），本 issue 范围内没有引入新的迁移基础设施，先记录
 * 清楚、留给 Build Gate 后续 issue 处理，不能假装没这回事。
 */
export async function recordOptOutKeywordTouch(
  input: RecordOptOutKeywordTouchInput,
  supabase: SupabaseClient = supabaseAdmin,
): Promise<RecordOptOutKeywordTouchResult> {
  const { clientId, contactId, channel, conversationId, messageId, occurredAt } = input
  const sourceRef = `${conversationId}:optout:${messageId}`

  const { data, error } = await supabase
    .from('contact_touchpoints')
    .upsert(
      {
        client_id: clientId,
        contact_id: contactId,
        channel,
        direction: 'inbound',
        occurred_at: occurredAt,
        summary: '系统自动判定：客户消息命中退订关键词',
        metadata: {
          outcome: 'do_not_contact',
          do_not_contact: true,
          detected_by: 'keyword',
        },
        source: channel,
        source_ref: sourceRef,
      },
      { onConflict: 'client_id,source,source_ref', ignoreDuplicates: true },
    )
    .select('id')
    .maybeSingle()

  if (error) {
    throw new Error(`写退订触点失败: ${error.message}`)
  }

  // 重放保护：这条事件之后如果已经有更晚的人工纠正（dnc_cleared），
  // 说明镜像列现在的值就该是那次纠正定的，不该被一条旧事件的重放推翻。
  const { data: existingTouches, error: touchErr } = await supabase
    .from('contact_touchpoints')
    .select('occurred_at, metadata')
    .eq('contact_id', contactId)
    .eq('client_id', clientId)

  if (touchErr) {
    throw new Error(`查已有触点失败: ${touchErr.message}`)
  }

  const touches: DncTouch[] = ((existingTouches as TouchpointRow[] | null) ?? []).map((t) => {
    const meta = t.metadata ?? {}
    return {
      outcome: (meta.outcome as string | undefined) ?? null,
      flagged: meta.do_not_contact === true,
      occurredAt: t.occurred_at,
    }
  })

  if (dncClearedAt(touches) > new Date(occurredAt).getTime()) {
    // 已经有更晚的人工纠正 —— 这条事件（大概率是旧 webhook 的重放）
    // 不许覆盖回去，镜像列维持纠正后的状态。
    return { touchpointId: (data as { id: string } | null)?.id ?? null }
  }

  // 镜像列更新（幂等），配合调用方带同 sourceRef 重试收敛 ——
  // 跟 recordManualTouchpoint() 的约定一致。
  const { error: updateErr } = await supabase
    .from('contacts')
    .update({ do_not_contact: true })
    .eq('id', contactId)
    .eq('client_id', clientId)

  if (updateErr) {
    throw new Error(`更新 contacts.do_not_contact 失败: ${updateErr.message}`)
  }

  return { touchpointId: (data as { id: string } | null)?.id ?? null }
}
