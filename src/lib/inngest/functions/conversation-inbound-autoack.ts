/**
 * Magic Engine 2.0 · Inngest 云端消费者：F1 自动安抚回复（issue #1584）
 *
 * 客户消息（Messenger/WhatsApp，事件渠道无关）进来之后，在任何人工审核 /
 * AI 起草介入之前，先发一条硬编码的安抚话术——同时也是打开 WhatsApp 72 小时
 * 免费窗口的关键动作（见 issue #1290 评论区 2026-09-02 补记：24 小时内不回，
 * WhatsApp 免费窗口根本不开）。
 *
 * 🔴 **本文件的模板绝不读 canonical / 知识库 / 任何客户事实**（v3 方案
 *    `~/.claude/plans/cts-tours-messenger-dynamic-pearl.md` §9.14 C.5，
 *    2026-09-14 对 issue #1584 原描述的正式纠正）。issue #1584 的原文写的是
 *    「模板从 canonical.factual_bullets 带出」——**那个说法已作废**。§9.14 C.5
 *    的原话：「F1 是唯一不经人工审核直接自动发送的路径，绝不能读
 *    `getClientKnowledge`/任何知识条目，否则一旦知识库里有未经客户确认的
 *    敏感事实，等于绕过双签闸自动说出去」。本文件因此：
 *      · 不 import `@/lib/knowledge/read`（`getClientKnowledge`）；
 *      · 不 import 任何 `canonical.*` / offerings 相关模块；
 *      · `AUTOACK_TEMPLATE` 是写死在这个文件里的常量字符串，中英双语、
 *        零客户专属事实（没有团名、价格、电话、日期）。
 *    改这个模板前必须重新走一次子牙+魏征复审，不是这个文件内部能拍板的事。
 *
 * ## 五道闸（issue #1584 骨架）
 *
 *   Step 0   opt-out 检查（#1575 `isConversationOptedOut`，fail-closed）
 *   Step 0.5 渠道 kill switch（#1578 `isChannelEnabled`，fail-closed）
 *   Step 0.8 售前/售后分类（#1576 `classifyConversation`）——post_sale 不发
 *   Step 1   发硬编码模板（#1578 `CHANNEL_SEND`）
 *   Step 2   emit `conversation/autoack.sent` 收尾事件
 *
 * 每一步各自一个 `step.run`（跟 `messenger-brief-after-sync.ts` 同一个理由：
 * 副作用必须在 step 里才会被 Inngest 缓存——`retries: 1` 时如果 Step 2 的
 * emit 失败重试，Step 1 的发送结果已经被 memoize，不会被同一次重放重发一遍）。
 *
 * ## 谁决定「这个客户该用哪份售后判据」——不写死 CTS
 *
 * `classifyConversation` 本身不带任何行业默认值（见 classify.ts 文件头），
 * 旅游行业的 `TOURISM_POST_SALE_POLICY` 是一个具名 Playbook 常量。本文件
 * 按 `clients.industry` 走跟 `industry-features.ts` 完全一样的「行业关键词
 * 匹配」路子选 policy（`resolvePostSaleClassificationPolicy`），不是
 * `if (clientId === CTS_ID)`——明天换成另一个旅游客户，这段代码不需要改。
 * 认不出行业 → 没有 Playbook 可用 → 直接按 `lead_intake` 处理（跟
 * `classifyConversation` 自己「查不到消息就保守判 lead_intake」的方向一致，
 * 不是「换了行业就不发」）。
 *
 * ## 一事件一主
 *
 * `conversation/message.received`（触发）和 `conversation/autoack.sent`
 * （产出）都不在 `WORKER_OWNED_EVENTS` 里——本机 factory-worker 不消费，
 * 契约测试锁死（见本文件测试）。
 */

import { randomUUID } from 'node:crypto'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import {
  CONVERSATION_MESSAGE_RECEIVED_EVENT,
  ConversationMessageReceivedSchema,
  type ConversationMessageReceivedData,
} from '@/lib/conversations/events'
import { isConversationOptedOut } from '@/lib/messenger-agent/optout'
import {
  isChannelEnabled,
  CHANNEL_SEND,
  type MessengerAgentChannel,
} from '@/lib/messenger-agent/channel-dispatch'
import {
  classifyConversation,
  TOURISM_POST_SALE_POLICY,
  type ConversationClass,
  type PostSaleClassificationPolicy,
} from '@/lib/messenger-agent/classify'
import { hasIndustryFeature } from '@/lib/clients/industry-features'
import type { SendReplyResult } from '@/lib/messenger/send'
import type { SendWhatsAppResult } from '@/lib/whatsapp/send'

export const CONVERSATION_AUTOACK_SENT_EVENT = 'conversation/autoack.sent'

/**
 * ⚠️ 系统身份，不是真人邮箱。`sendReply`/`sendWhatsApp` 的 `sentByEmail` 字段
 * 现有全部调用方（`messenger/conversations/[id]/reply` 路由、
 * `messaging/adapters/*`）都是「登录用户手点发送」，全仓 grep 确认没有既有的
 * 自动化发信身份约定可复用。这里显式钉一个可识别的系统身份，方便日后审计
 * `conversation_outbound_log` 时一眼看出这条是 F1 自动发的，不是某个真人
 * 账号发的——这是本次实现里唯一没有现成约定可抄、需要自己定的判断，已在
 * PR 描述里留痕给复审看。
 */
export const AUTOACK_SENT_BY_EMAIL = 'governed-reply-agent@magicengine.cloud'

/**
 * 🔴 硬编码、双语、零客户专属事实——见文件头 §9.14 C.5 说明。
 * 不含团名/价格/电话/日期，任何行业、任何客户都能收到这条而不会说错话。
 */
export const AUTOACK_TEMPLATE =
  "Thanks for your message — one of our team will get back to you with the details shortly.\n" +
  '感谢您的留言，我们的顾问正在为您整理详细信息，稍后回复您。'

export type AutoAckOutcome =
  | 'sent'
  | 'skipped_opted_out'
  | 'skipped_channel_disabled'
  | 'skipped_post_sale'
  | 'skipped_invalid_payload'
  | 'send_failed'

export interface AutoAckReceipt {
  readonly outcome: AutoAckOutcome
  readonly conversation_id: string | null
  readonly client_id: string | null
  readonly channel: string | null
  readonly detail: string | null
}

export type ParsedMessageReceived =
  | { readonly ok: true; readonly value: ConversationMessageReceivedData }
  | { readonly ok: false; readonly reason: string }

/**
 * payload 校验，抽出来供直测。复用 webhook 那份共享 Zod 契约
 * （`@/lib/conversations/events.ts`），不重复定义形状——那份契约的头注释
 * 明确说 Messenger/WhatsApp 两条 webhook 靠同一个事件名 + `data.channel`
 * 区分渠道，F1/F2/F3/F4 都该按这份契约读，不是各自再定义一份。
 */
export function parseMessageReceived(raw: unknown): ParsedMessageReceived {
  const parsed = ConversationMessageReceivedSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid_payload' }
  }
  return { ok: true, value: parsed.data }
}

function isKnownAutoAckChannel(channel: string): channel is MessengerAgentChannel {
  return channel === 'messenger' || channel === 'whatsapp'
}

/**
 * 这个客户该用哪份售后判据——按行业关键词匹配（跟
 * `industryFeatureFlags`/`hasIndustryFeature` 同一套判法），不是按
 * `clientId` 硬编码。目前只有旅游行业有具名 Playbook；其它行业没有对应
 * 判据时返回 `null`，调用方按 `lead_intake` 处理（不猜、不套错行业的判据）。
 */
export function resolvePostSaleClassificationPolicy(
  industry: string | null | undefined,
): PostSaleClassificationPolicy | null {
  if (hasIndustryFeature(industry, 'tailor_made')) return TOURISM_POST_SALE_POLICY
  return null
}

/** 生产实现：查 `clients.industry`，查不到/报错都按「认不出行业」处理（不阻断发送）。 */
async function loadClientIndustry(clientId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('industry')
    .eq('id', clientId)
    .maybeSingle()
  if (error || !data) return null
  return (data as { industry: string | null }).industry ?? null
}

type ChannelSendFn = (input: {
  clientId: string
  conversationId: string
  body: string
  sentByEmail: string
  usedAiDraft: boolean
}) => Promise<SendReplyResult | SendWhatsAppResult>

export interface ConversationInboundAutoAckDeps {
  isOptedOut: (conversationId: string) => Promise<boolean>
  isEnabled: (clientId: string, channel: string) => Promise<boolean>
  classify: (conversationId: string, policy: PostSaleClassificationPolicy) => Promise<ConversationClass>
  loadIndustry: (clientId: string) => Promise<string | null>
  send: Record<MessengerAgentChannel, ChannelSendFn>
}

/** 依赖注入版：单测直接注入假的 opt-out/kill-switch/classify/send，不碰真数据库、不真发消息。 */
export function createConversationInboundAutoAckFunction(deps: ConversationInboundAutoAckDeps) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}conversation-inbound-autoack`,
      name: 'Governed Reply — F1 auto-acknowledgement',
      retries: 1,
      // v3 补丁#2：Meta 的 webhook 是至少一次投递，客人连发几条消息也会拆成
      // 几个独立事件——30 秒内合并成一次安抚，不是每条消息各回一遍。
      debounce: { period: '30s', key: 'event.data.conversation_id' },
    },
    { event: CONVERSATION_MESSAGE_RECEIVED_EVENT },
    async ({ event, step }): Promise<AutoAckReceipt> => {
      const parsed = parseMessageReceived(event.data)
      if (!parsed.ok) {
        return {
          outcome: 'skipped_invalid_payload',
          conversation_id: null,
          client_id: null,
          channel: null,
          detail: parsed.reason,
        }
      }

      const { client_id, conversation_id, channel, direction } = parsed.value
      const base = { conversation_id, client_id, channel } as const

      // 只处理客户发进来的消息——我们自己发出去的消息如果也走这个事件名，
      // 不该触发一次「自动安抚」回自己。
      if (direction !== 'inbound') {
        return { ...base, outcome: 'skipped_invalid_payload', detail: `not_inbound:${direction}` }
      }

      // F1/F2 目前只认 messenger/whatsapp——事件契约的 channel 枚举还含
      // email/voice（其它渠道复用同一套 conversations 表），那两个不归这条
      // 自动安抚管，按「payload 认不出」处理，不猜、不硬转。
      if (!isKnownAutoAckChannel(channel)) {
        return { ...base, outcome: 'skipped_invalid_payload', detail: `unsupported_channel:${channel}` }
      }

      // Step 0：opt-out 检查（fail-closed，见 optout.ts 文件头「出错时宁可拦
      // 一条，不放过一条」）。
      //
      // 🔴 判断记录（要不要额外挂一条 pm-todo）：一个已经标记拒联的联系人又
      // 发消息进来，理论上是"可能想解除拒联"的信号，但这里刻意不新建一个
      // pm-todo 条目——`pm-todo/manual-items.ts` 现有的 push*Items 都是"定时
      // 任务扫已落库状态"的读时聚合模式，不是"事件到达就实时写一条"；这条对话
      // 本身仍然正常出现在 CRM 收件箱里（拒联状态本来就在联系人资料上可见），
      // 员工翻收件箱时天然会看到，不缺一个额外的提醒入口。真要做"拒联后又发
      // 消息"专属提醒，应该是 `manual-items.ts` 里新增一种 `ManualItemKind`
      // 的独立改动（有自己的 what/how/href 设计），不该顺手塞进这个函数——
      // 留白，不是漏做。
      const optedOut = await step.run('check-opt-out', () => deps.isOptedOut(conversation_id))
      if (optedOut) {
        return { ...base, outcome: 'skipped_opted_out', detail: null }
      }

      // Step 0.5：渠道 kill switch（fail-closed，见 channel-dispatch.ts 文件头）。
      // 这是 ME/PM 自己按下的开关，不是异常状态，不需要提醒任何人。
      const enabled = await step.run('check-channel-enabled', () => deps.isEnabled(client_id, channel))
      if (!enabled) {
        return { ...base, outcome: 'skipped_channel_disabled', detail: null }
      }

      // Step 0.8：售前/售后分类——判据按行业注入，本函数不写死任何客户/行业。
      //
      // 🔴 同上，不额外挂 pm-todo：售后对话本来就需要员工手动处理（这正是
      // "不发自动安抚"的原因——不想让 AI 对一个已购客户随口说"我们的顾问会
      // 联系您"这种对售后场景不成立的话），而售后对话跟售前一样会出现在同
      // 一个 CRM 收件箱里，不缺一个专属提醒。
      const conversationClass = await step.run('classify-conversation', async () => {
        const industry = await deps.loadIndustry(client_id)
        const policy = resolvePostSaleClassificationPolicy(industry)
        return policy ? deps.classify(conversation_id, policy) : ('lead_intake' as ConversationClass)
      })
      if (conversationClass === 'post_sale') {
        return { ...base, outcome: 'skipped_post_sale', detail: null }
      }

      // Step 1：发硬编码模板。不调 Claude，不占 verifier，不读任何知识源
      // （见文件头 §9.14 C.5）。
      const sendResult = await step.run('send-autoack', () =>
        deps.send[channel]({
          clientId: client_id,
          conversationId: conversation_id,
          body: AUTOACK_TEMPLATE,
          sentByEmail: AUTOACK_SENT_BY_EMAIL,
          usedAiDraft: false,
        }),
      )
      if (!sendResult.ok) {
        return { ...base, outcome: 'send_failed', detail: sendResult.reason }
      }

      // Step 2：emit 收尾事件。id 用事件本身的稳定 id（重放/重试不变）拼会话
      // id 保证幂等；本地直接触发等没有 event.id 的场景才退化成随机值。
      await step.run('emit-autoack-sent', () =>
        step.sendEvent('autoack-sent', {
          id: `autoack:${conversation_id}:${event.id ?? randomUUID()}`,
          name: CONVERSATION_AUTOACK_SENT_EVENT,
          data: { client_id, conversation_id, channel },
        }),
      )

      return { ...base, outcome: 'sent', detail: null }
    },
  )
}

/** 生产实例。 */
export const conversationInboundAutoAck = createConversationInboundAutoAckFunction({
  isOptedOut: isConversationOptedOut,
  isEnabled: isChannelEnabled,
  classify: classifyConversation,
  loadIndustry: loadClientIndustry,
  send: CHANNEL_SEND,
})
