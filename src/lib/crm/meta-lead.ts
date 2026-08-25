/**
 * Meta 即时表单 lead → 统一联系人 + 一条带归因的触点。
 *
 * 跟 `src/lib/crm/web-form-lead.ts` 是同一类东西（渠道适配器），写法刻意保持一致：
 * 建人走 `resolveContact`，触点按 `(client_id, source, source_ref)` 幂等 upsert。
 *
 * 幂等键跟人手导入脚本**完全对齐**：两边的 `source_ref` 都是 Meta 的 lead id
 * （`scripts/import-cts-fb-leads.ts` 用 CSV 的 `id` 列，就是同一个值）。所以自动
 * 管道第一次回补时，7/26 已经手动导进去的 335 人不会被写成第二份。
 *
 * 合并策略用 'auto'（不是官网表单那个 'reject'），依据是 identity.ts 里已经写死的
 * 判断：「Meta 表单里的电话和邮箱天然来自同一次提交，是同一个人的两个身份，合并
 * 才对」。这条是渠道适配器的既定设计，人手导入脚本也是这么走的 —— 这里不另立规矩。
 *
 * 永不抛异常：一条脏 lead 不能弄停整批同步（防护 C）。失败如实计数并回报。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { buildIdentities, resolveContact } from '@/lib/crm/identity'
import { attributionColumns, attributionFromMetaLeadRow } from '@/lib/crm/attribution'
import { lookupCreativeRefByAdId } from '@/lib/ads/creative-link'
import { subscribeMember, type SubscribeMemberResult } from '@/lib/mailchimp/client'
import type { MetaLead, MetaLeadAnswer } from '@/lib/meta/lead-forms'

/**
 * Meta 的标准字段名（表单里的「联系信息」那类问题）。除这些之外的都是客户自己
 * 加的自定义问题，原样存进 metadata.custom_answers。
 */
const STANDARD_FIELDS = new Set([
  'full_name',
  'first_name',
  'last_name',
  'email',
  'phone_number',
  'phone',
])

export interface ParsedLeadAnswers {
  name: string | null
  /**
   * 拆开的名/姓。Meta 表单交上来的形式两种都有（full_name 一整段 / first+last
   * 两个字段），Mailchimp 的 FNAME/LNAME merge field 只吃拆开的。full_name 用
   * 第一个空格拆一次，剩下的都算 LNAME —— 这是共识做法，别为了处理 "Van der
   * Berg" 这种边角自己造 heuristic。
   */
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
  /**
   * 「感兴趣的团」。**只认问题名里带 tour 的自定义问题** —— 不是「取第一个自定义
   * 答案」。CRM 横表那一列的表头写死是「感兴趣的团」（table-columns.ts），拿别的
   * 客户随便一个自定义问题去填，列名就成了假的。宁可空着。
   */
  tourInterest: string | null
  /**
   * marketing 同意证据。**在 Meta 表单的答案里**必须找到一个问题名匹配
   * consent / subscribe / newsletter / opt-in / marketing 的自定义问题，
   * 且值不是 "no/false/0"。缺这一条 = 没有 provable consent，Mailchimp 出口
   * 一律 skip（Issue #1188 consent gate 1/2/7）。
   *
   * 这里存的是「找到的问题名」，不是 boolean —— 方便回查具体是哪个字段做的
   * 判断，将来审计不会两眼一抹黑。找不到就 null。
   */
  consentEvidence: string | null
  /** 全部自定义问答，原样保留，将来加列不用重跑历史。 */
  custom: Record<string, string>
}

/** 匹配 marketing consent 类问题名的模式。宽松一点，Meta 表单的表述五花八门。 */
const CONSENT_QUESTION_PATTERN = /consent|subscribe|newsletter|opt.?in|marketing|email.*update/i

/** consent 值里明确表达「不同意」的写法。命中这些就不算 provable consent。 */
const CONSENT_DECLINE_PATTERN = /^(no|false|0|n|拒绝|不同意|no thanks)$/i

/** 一次提交的问答 → 结构化字段。纯函数，不碰数据库。 */
export function parseLeadAnswers(answers: MetaLeadAnswer[]): ParsedLeadAnswers {
  const std = new Map<string, string>()
  const custom: Record<string, string> = {}

  for (const a of answers) {
    const key = a.name.trim().toLowerCase()
    const value = a.value.trim()
    if (!key || !value) continue
    if (STANDARD_FIELDS.has(key)) std.set(key, value)
    else custom[a.name.trim()] = value
  }

  const fullName = std.get('full_name')
  const composed = [std.get('first_name'), std.get('last_name')].filter(Boolean).join(' ').trim()

  let tourInterest: string | null = null
  let consentEvidence: string | null = null
  for (const [question, value] of Object.entries(custom)) {
    if (tourInterest === null && /tour/i.test(question)) {
      tourInterest = value
    }
    if (
      consentEvidence === null &&
      CONSENT_QUESTION_PATTERN.test(question) &&
      !CONSENT_DECLINE_PATTERN.test(value.trim())
    ) {
      consentEvidence = question
    }
  }

  let firstName = std.get('first_name') ?? null
  let lastName = std.get('last_name') ?? null
  if ((!firstName || !lastName) && fullName) {
    const spaceIdx = fullName.indexOf(' ')
    if (spaceIdx > 0) {
      firstName = firstName ?? fullName.slice(0, spaceIdx)
      lastName = lastName ?? (fullName.slice(spaceIdx + 1).trim() || null)
    } else {
      firstName = firstName ?? fullName
    }
  }

  return {
    name: fullName ?? (composed || null),
    firstName: firstName?.trim() || null,
    lastName: lastName?.trim() || null,
    email: std.get('email') ?? null,
    phone: std.get('phone_number') ?? std.get('phone') ?? null,
    tourInterest,
    consentEvidence,
    custom,
  }
}

export interface IngestMetaLeadInput {
  clientId: string
  /** 本地号码补哪个国码。按客户市场传（NZ 021… / AU 04…）。 */
  defaultCountry: 'NZ' | 'AU'
  lead: MetaLead
}

export interface IngestMetaLeadResult {
  contactId: string | null
  /** true = 这条 lead 让系统里多了一个新人。 */
  createdContact: boolean
  /** 没接进来的原因；接进来了就是 null。 */
  skipped: 'no_identity' | 'error' | null
  /**
   * Mailchimp 出口的结果（如果这一步跑了的话）。null = 没跑（例如 no_identity
   * 直接返回）。观测和测试用；主管道的成败**不受它影响** —— provider 失败不会
   * 让 Meta lead 接入回滚（Issue #1188 硬约束）。
   */
  mailchimp: SubscribeMemberResult | null
}

/**
 * 一条 Meta lead → contact + inbound 触点。
 *
 * 电话和邮箱都不成形就不建人 —— contacts 表被垃圾提交灌脏，比漏一条 lead 贵得多
 * （板桥的「护栏 · 一等公民」：只有真实触点才升级成客户）。
 */
export async function ingestMetaLead(input: IngestMetaLeadInput): Promise<IngestMetaLeadResult> {
  const { clientId, lead } = input

  try {
    const parsed = parseLeadAnswers(lead.answers)

    const identities = buildIdentities({
      phone: parsed.phone,
      email: parsed.email,
      defaultCountry: input.defaultCountry,
    })
    if (identities.length === 0) {
      return { contactId: null, createdContact: false, skipped: 'no_identity', mailchimp: null }
    }

    // 这条记录来自 Meta lead 表单 → platform 一定是 'meta'（事实，不是猜的）。
    // ad / adset / campaign 有就写、没有就 null（自然贴文的表单本来就没有）。
    const attribution = attributionFromMetaLeadRow({
      ad_id: lead.adId,
      ad_name: lead.adName,
      adset_id: lead.adsetId,
      campaign_id: lead.campaignId,
      // creative id：Meta 的 lead 接口不给。只能拿 ad_id 回查 ME 自己在建广告那一刻
      // 记下的对应关系（ad_creative_links）。那条广告不是 ME 建的、或者当时就没认出
      // 是哪条片子 → 这里照样是 null，如实留白（见 lib/ads/creative-link.ts）。
      creative_ref: await lookupCreativeRefByAdId(clientId, lead.adId),
    })

    const { contactId, created } = await resolveContact({
      clientId,
      identities,
      displayName: parsed.name,
      source: 'meta_lead_form',
      seenAt: lead.createdTime,
      attribution,
    })

    // Mailchimp 出口：先跑 provider（`syncMailchimp` 自己吞异常，永远返回一个
    // 结果对象），把结果写进本条触点的 metadata —— 一个动作产生一次记录，不用
    // 新表也不用二次 update。provider 成败**不影响**下面的触点 upsert。
    const mailchimp = await syncMailchimp({
      clientId,
      contactId,
      parsed,
      leadId: lead.leadId,
    })

    const { error } = await supabaseAdmin.from('contact_touchpoints').upsert(
      {
        client_id: clientId,
        contact_id: contactId,
        channel: 'meta_lead_form',
        // 客户自己填的表 —— 方向是进来的。
        direction: 'inbound',
        occurred_at: lead.createdTime,
        // 跟人手导入写出来的那 347 条保持同一句式，时间线上看不出两条管道。
        summary: `填了 Facebook 表单${parsed.tourInterest ? ` · ${parsed.tourInterest}` : ''}`,
        raw: null,
        metadata: {
          tour_interest_raw: parsed.tourInterest,
          ad_name: lead.adName,
          form_id: lead.formId,
          meta_platform: lead.platform,
          is_organic: lead.isOrganic,
          custom_answers: parsed.custom,
          ingested_by: 'meta-leads-sync',
          // 观测：这条 lead 的 Mailchimp 出口跑成了什么。**只落 status + reason**
          // —— 不落邮箱、不落 provider body、不落 audience id（不是敏感但也没
          // 必要复读）。
          mailchimp_result: mailchimp,
        },
        // 触点也存一份归因：同一个人可能被两条不同的广告分别捞到过，只看 contacts
        // 上那份 first-touch 会让第二条广告的贡献永远看不见。
        ...attributionColumns(attribution),
        source: 'meta_lead_form',
        source_ref: lead.leadId,
      },
      { onConflict: 'client_id,source,source_ref', ignoreDuplicates: true },
    )
    if (error) throw new Error(error.message)

    // 只在明确成功或安全确认已存在时，才动 contacts.mailchimp_synced_at。
    // 该列的语义是「audience 会员关系已确认」，不承担「Welcome 邮件已投递」。
    if (mailchimp.status === 'subscribed' || mailchimp.status === 'already_member') {
      const { error: syncErr } = await supabaseAdmin
        .from('contacts')
        .update({ mailchimp_synced_at: new Date().toISOString() })
        .eq('id', contactId)
      if (syncErr) {
        // 观测列没写上不影响主管道；如实 warn，不 throw。
        console.warn(
          `[meta-lead] contact ${contactId} mailchimp_synced_at 更新失败: ${syncErr.message}`,
        )
      }
    }

    return { contactId, createdContact: created, skipped: null, mailchimp }
  } catch (err) {
    console.error(`[meta-lead] lead ${lead.leadId} 接入失败:`, err)
    return { contactId: null, createdContact: false, skipped: 'error', mailchimp: null }
  }
}

// ── Mailchimp 出口 ──────────────────────────────────────────────────────────

interface SyncMailchimpInput {
  clientId: string
  contactId: string
  parsed: ParsedLeadAnswers
  leadId: string
}

/**
 * 把一个 lead → Mailchimp audience。**永远返回结果对象**，绝不 throw。
 *
 * gate 顺序（Issue #1188 硬约束）：
 *   1. 客户是否配置了 audience id —— 没配 → skipped: no_audience_config
 *   2. 是否有邮箱 —— 没有 → skipped: no_email
 *   3. 是否拿到 API key —— 没有 → skipped: no_api_key
 *   4. lead 里是否携带 provable consent 证据 —— 没有 → skipped: no_consent_evidence
 *   5. 满足以上，才调 subscribeMember
 */
async function syncMailchimp(input: SyncMailchimpInput): Promise<SubscribeMemberResult> {
  // 1. 客户配置。**只 select 出口需要的那一列**，别顺手拉全表。
  const { data: clientRow, error: clientErr } = await supabaseAdmin
    .from('clients')
    .select('mailchimp_audience_id')
    .eq('id', input.clientId)
    .maybeSingle()
  if (clientErr) {
    // 查配置失败 = 不该猜「有」也不该猜「没有」，如实 skipped：cron 日志能看见。
    return { status: 'skipped', reason: 'client_config_read_failed' }
  }
  const audienceId =
    typeof clientRow?.mailchimp_audience_id === 'string'
      ? clientRow.mailchimp_audience_id.trim()
      : ''
  if (!audienceId) {
    return { status: 'skipped', reason: 'no_audience_config' }
  }

  // 2. 邮箱
  const email = input.parsed.email?.trim().toLowerCase() ?? ''
  if (!email) {
    return { status: 'skipped', reason: 'no_email' }
  }

  // 3. API key（跑时读，不放模块顶层 —— CLAUDE.md 规矩）
  const apiKey = process.env.MAILCHIMP_API_KEY ?? ''
  if (!apiKey.trim()) {
    return { status: 'skipped', reason: 'no_api_key' }
  }

  // 4. Consent 证据
  if (!input.parsed.consentEvidence) {
    return { status: 'skipped', reason: 'no_consent_evidence' }
  }

  // 5. 打出去
  try {
    return await subscribeMember({
      apiKey,
      audienceId,
      email,
      firstName: input.parsed.firstName,
      lastName: input.parsed.lastName,
      // SOURCE merge field —— Mailchimp 后台分组用。写死 Meta Lead Form 表明
      // 这个人是从 Facebook 表单进来的，不是网站 newsletter。
      source: 'Meta Lead Form',
      tag: 'meta-lead',
    })
  } catch {
    // subscribeMember 应该永远不 throw，兜底防御。
    return { status: 'failed', reason: 'unexpected_exception' }
  }
}
