/**
 * Facebook 表单 lead → 联系人 + 触点 + Mailchimp 出口的测试。
 *
 * 钉住的事，每一件错了都会在生产里变成「看不见的漏人」或「弄脏干净的表」或
 * 「把没同意的人发进 Welcome journey」：
 *   1. 幂等键 = Meta 的 lead id —— 跟人手导入脚本对齐，回补时不会写出第二份
 *   2. 电话邮箱都不成形就不建人 —— contacts 被垃圾提交灌脏比漏一条 lead 贵得多
 *   3. 归因照实写，拿不到就 NULL —— 自然贴文的表单本来就没有广告
 *      （含素材：ad_id 回查 ad_creative_links，查不到照样 NULL，不猜）
 *   4. 「感兴趣的团」只认问题名带 tour 的自定义问题 —— 不是随便抓第一个自定义答案
 *   5. Mailchimp 出口只在**有 provable consent** 时才打 provider（Issue #1188）
 *   6. Provider 失败**不能**把 lead 接入回滚 —— 主管道优先
 *   7. `mailchimp_synced_at` 只在 subscribed / 明确 already_member 时才写
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

vi.mock('@/lib/mailchimp/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/mailchimp/client')>(
    '@/lib/mailchimp/client',
  )
  return {
    ...actual,
    subscribeMember: vi.fn(),
  }
})

import { supabaseAdmin } from '@/lib/supabase'
import { subscribeMember } from '@/lib/mailchimp/client'
import { ingestMetaLead, parseLeadAnswers } from '../meta-lead'
import type { MetaLead } from '@/lib/meta/lead-forms'

const CLIENT = 'client-cts'
const subscribeMock = subscribeMember as unknown as ReturnType<typeof vi.fn>

const lead = (over: Partial<MetaLead> = {}): MetaLead => ({
  leadId: 'lead-1',
  createdTime: '2026-07-28T04:19:48.000Z',
  formId: 'form-1',
  adId: 'ad1',
  adName: 'Reel A',
  adsetId: 'as1',
  campaignId: 'c1',
  platform: 'fb',
  isOrganic: false,
  answers: [
    { name: 'full_name', value: 'Chris Brown' },
    { name: 'email', value: 'Chris@Example.com' },
    { name: 'phone_number', value: 'p:+6421363598' },
  ],
  ...over,
})

let contactInserts: Record<string, unknown>[]
let touchpointUpserts: Record<string, unknown>[]
let upsertOptions: Record<string, unknown>[]
let contactUpdates: Record<string, unknown>[]

interface MockDbOptions {
  identityHits?: { contact_id: string; kind: string; value: string }[]
  /** ad_creative_links 里这条广告对应的片子；null = 这条广告不是 ME 建的。 */
  creativeLinkRow?: { creative_ref: string } | null
  /** clients.mailchimp_audience_id；undefined = 客户不存在，null/'' = 未配置。 */
  audienceId?: string | null
  clientReadError?: string | null
  contactUpdateError?: string | null
  /** DNC 判据的输入。默认：do_not_contact=false，触点没有任何 dnc 类记录。 */
  contactDncFlag?: boolean
  /** 触点里已存在的 DNC 类记录（用来测跨渠道拒联）。默认 `[]`。 */
  existingDncTouches?: Array<{ outcome?: string | null; do_not_contact?: boolean; occurred_at: string }>
  /** 读 contacts.do_not_contact 失败；默认 null（成功）。 */
  contactReadError?: string | null
  /** 读 contact_touchpoints 的 select 失败；默认 null（成功）。 */
  touchpointReadError?: string | null
}

function mockDb(opts: MockDbOptions = {}) {
  const {
    identityHits = [],
    creativeLinkRow = null,
    audienceId = null,
    clientReadError = null,
    contactUpdateError = null,
    contactDncFlag = false,
    existingDncTouches = [],
    contactReadError = null,
    touchpointReadError = null,
  } = opts
  contactInserts = []
  touchpointUpserts = []
  upsertOptions = []
  contactUpdates = []
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    if (table === 'ad_creative_links') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: () => Promise.resolve({ data: creativeLinkRow, error: null }) }),
            }),
          }),
        }),
      }
    }
    if (table === 'contact_identities') {
      return {
        select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: identityHits }) }) }),
        update: () => ({ in: () => Promise.resolve({ error: null }) }),
        upsert: () => Promise.resolve({ error: null }),
      }
    }
    if (table === 'clients') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve(
                clientReadError
                  ? { data: null, error: { message: clientReadError } }
                  : { data: { mailchimp_audience_id: audienceId }, error: null },
              ),
          }),
        }),
      }
    }
    if (table === 'contacts') {
      // 两种 select 形态：
      //   • resolveContact 走 .in(...).order(...) —— 返回 []（新人）
      //   • syncMailchimp/evaluateDnc 走 .eq('id',…).maybeSingle() —— 返回单条
      const selectApi = () => ({
        // 给 resolveContact 用（.in().order()）
        in: () => ({ order: () => Promise.resolve({ data: [] }) }),
        // 给 evaluateDnc 用（.eq().maybeSingle()）
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve(
              contactReadError
                ? { data: null, error: { message: contactReadError } }
                : { data: { do_not_contact: contactDncFlag }, error: null },
            ),
        }),
      })
      return {
        insert: (payload: Record<string, unknown>) => {
          contactInserts.push(payload)
          return {
            select: () => ({ single: () => Promise.resolve({ data: { id: 'person-new' } }) }),
          }
        },
        select: selectApi,
        update: (payload: Record<string, unknown>) => {
          contactUpdates.push(payload)
          return {
            eq: () =>
              Object.assign(
                Promise.resolve(
                  contactUpdateError ? { error: { message: contactUpdateError } } : { error: null },
                ),
                {
                  is: () =>
                    Promise.resolve(
                      contactUpdateError ? { error: { message: contactUpdateError } } : { error: null },
                    ),
                },
              ),
          }
        },
      }
    }
    if (table === 'contact_touchpoints') {
      // 两种 select 形态：
      //   • evaluateDnc 走 .select('metadata,occurred_at').eq('contact_id', …)
      //     —— thenable，直接 await 拿 { data, error }
      //   • 其它读方（若将来有）走既有链式；本文件目前只有 upsert / update
      const dncData = existingDncTouches.map((t) => ({
        metadata: {
          outcome: t.outcome ?? null,
          do_not_contact: t.do_not_contact === true,
        },
        occurred_at: t.occurred_at,
      }))
      return {
        update: () => ({ in: () => Promise.resolve({ error: null }) }),
        select: () => ({
          eq: () =>
            Promise.resolve(
              touchpointReadError
                ? { data: null, error: { message: touchpointReadError } }
                : { data: dncData, error: null },
            ),
        }),
        upsert: (row: Record<string, unknown>, opts: Record<string, unknown>) => {
          touchpointUpserts.push(row)
          upsertOptions.push(opts)
          return Promise.resolve({ error: null })
        },
      }
    }
    throw new Error(`unexpected table ${table}`)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  subscribeMock.mockReset()
  // Default: 出口没配 audience —— 上游看到 skipped: no_audience_config，
  // subscribeMember 不该被调用。测试要打 provider 的用例自行覆写。
  subscribeMock.mockResolvedValue({ status: 'skipped', reason: 'no_audience_config' })
  process.env.MAILCHIMP_API_KEY = 'test-key-us19'
})

describe('parseLeadAnswers', () => {
  it('标准字段各归各位', () => {
    const p = parseLeadAnswers([
      { name: 'full_name', value: 'Chris Brown' },
      { name: 'email', value: 'chris@example.com' },
      { name: 'phone_number', value: 'p:+6421363598' },
    ])
    expect(p).toMatchObject({
      name: 'Chris Brown',
      email: 'chris@example.com',
      phone: 'p:+6421363598',
    })
  })

  it('没有 full_name 时用 first + last 拼', () => {
    const p = parseLeadAnswers([
      { name: 'first_name', value: 'Chris' },
      { name: 'last_name', value: 'Brown' },
    ])
    expect(p.name).toBe('Chris Brown')
  })

  it('「感兴趣的团」只认问题名带 tour 的', () => {
    const p = parseLeadAnswers([
      { name: 'which_tour_interests_you_most?', value: 'Best of China' },
      { name: 'budget', value: '$5000' },
    ])
    expect(p.tourInterest).toBe('Best of China')
    expect(p.custom).toEqual({
      'which_tour_interests_you_most?': 'Best of China',
      budget: '$5000',
    })
  })

  it('没有 tour 问题就留空 —— 不拿别的自定义答案冒充', () => {
    const p = parseLeadAnswers([{ name: 'budget', value: '$5000' }])
    expect(p.tourInterest).toBeNull()
    expect(p.custom).toEqual({ budget: '$5000' })
  })

  it('空值不占位', () => {
    const p = parseLeadAnswers([
      { name: 'email', value: '   ' },
      { name: '', value: 'x' },
    ])
    expect(p.email).toBeNull()
    expect(p.custom).toEqual({})
  })

  it('consent 类问题 + 明确肯定短值 → provable consent', () => {
    const p = parseLeadAnswers([
      { name: 'consent_to_marketing_emails', value: 'Yes' },
    ])
    expect(p.consentEvidence).toBe('consent_to_marketing_emails')
    expect(p.optOutEvidence).toBeNull()
  })

  it('consent 字段答 "No" → 不算 provable consent', () => {
    const p = parseLeadAnswers([
      { name: 'subscribe_to_newsletter', value: 'No' },
      { name: 'opt_in', value: 'false' },
    ])
    expect(p.consentEvidence).toBeNull()
  })

  it('没有 consent 类问题 → consentEvidence 为 null（不猜）', () => {
    const p = parseLeadAnswers([{ name: 'budget', value: '$5000' }])
    expect(p.consentEvidence).toBeNull()
  })

  // ── Remediation P1 `PRRT_kwDOSTHiF86cIG3N`：consent = 明确肯定白名单 ────────

  it('长句拒绝 "No, I do not consent" → consentEvidence 为 null（fail-closed）', () => {
    const p = parseLeadAnswers([
      { name: 'consent_to_marketing_emails', value: 'No, I do not consent' },
    ])
    expect(p.consentEvidence).toBeNull()
  })

  it('长句拒绝 "I don\'t want updates" → consentEvidence 为 null', () => {
    const p = parseLeadAnswers([
      { name: 'marketing_updates', value: "I don't want updates" },
    ])
    expect(p.consentEvidence).toBeNull()
  })

  it('未知短值 "OK maybe" → consentEvidence 为 null（未知不当同意）', () => {
    const p = parseLeadAnswers([
      { name: 'consent', value: 'OK maybe' },
    ])
    expect(p.consentEvidence).toBeNull()
  })

  it('opt-out 问题 + 明确肯定 "Yes" → optOutEvidence 命中，consentEvidence 保持 null', () => {
    const p = parseLeadAnswers([
      { name: 'marketing_opt_out', value: 'Yes' },
    ])
    expect(p.optOutEvidence).toBe('marketing_opt_out')
    expect(p.consentEvidence).toBeNull()
  })

  it('opt-out 问题 + 别的 consent 问题同时存在 —— optOutEvidence 保留，供上游 fail-closed', () => {
    const p = parseLeadAnswers([
      { name: 'subscribe_to_newsletter', value: 'Yes' },
      { name: 'marketing_opt_out', value: 'Yes' },
    ])
    // opt-out 命中；上游 syncMailchimp 会看到 optOutEvidence 后直接 skip
    expect(p.optOutEvidence).toBe('marketing_opt_out')
    expect(p.consentEvidence).toBe('subscribe_to_newsletter')
  })

  it('unsubscribe 问题 + "Yes" → optOutEvidence 命中', () => {
    const p = parseLeadAnswers([
      { name: 'unsubscribe_from_emails', value: 'Yes' },
    ])
    expect(p.optOutEvidence).toBe('unsubscribe_from_emails')
  })

  it('email 字段本身不算 consent（就算 email 值非空）', () => {
    const p = parseLeadAnswers([
      { name: 'email', value: 'chris@example.com' },
    ])
    expect(p.consentEvidence).toBeNull()
  })

  it('full_name → firstName/lastName 按第一个空格拆一次', () => {
    const p = parseLeadAnswers([{ name: 'full_name', value: 'Chris van der Berg' }])
    expect(p.firstName).toBe('Chris')
    expect(p.lastName).toBe('van der Berg')
  })

  it('first_name + last_name 显式给出 → 直接用，不重拼', () => {
    const p = parseLeadAnswers([
      { name: 'first_name', value: 'Chris' },
      { name: 'last_name', value: 'Brown' },
    ])
    expect(p.firstName).toBe('Chris')
    expect(p.lastName).toBe('Brown')
  })
})

describe('ingestMetaLead', () => {
  it('新 lead 建人 + 写一条 inbound 触点', async () => {
    mockDb({})
    const res = await ingestMetaLead({ clientId: CLIENT, defaultCountry: 'NZ', lead: lead() })

    expect(res).toMatchObject({ contactId: 'person-new', createdContact: true, skipped: null })
    expect(contactInserts).toHaveLength(1)
    expect(contactInserts[0]).toMatchObject({
      primary_phone: '+6421363598',
      primary_email: 'chris@example.com',
      display_name: 'Chris Brown',
    })

    expect(touchpointUpserts).toHaveLength(1)
    expect(touchpointUpserts[0]).toMatchObject({
      channel: 'meta_lead_form',
      direction: 'inbound',
      occurred_at: '2026-07-28T04:19:48.000Z',
      source: 'meta_lead_form',
      attr_platform: 'meta',
      attr_ad_id: 'ad1',
    })
  })

  it('幂等键就是 Meta 的 lead id —— 跟人手导入脚本对齐，回补不会写第二份', async () => {
    mockDb({})
    await ingestMetaLead({ clientId: CLIENT, defaultCountry: 'NZ', lead: lead() })

    expect(touchpointUpserts[0].source_ref).toBe('lead-1')
    expect(upsertOptions[0]).toMatchObject({
      onConflict: 'client_id,source,source_ref',
      ignoreDuplicates: true,
    })
  })

  it('电话邮箱都不成形 → 不建人（不能让垃圾提交灌脏 contacts）', async () => {
    mockDb({})
    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: lead({ answers: [{ name: 'full_name', value: '张三' }] }),
    })

    expect(res).toMatchObject({ contactId: null, createdContact: false, skipped: 'no_identity' })
    expect(contactInserts).toEqual([])
    expect(touchpointUpserts).toEqual([])
  })

  it('自然贴文的表单：platform 仍是 meta，广告字段照实留 NULL', async () => {
    mockDb({})
    await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: lead({ adId: null, adName: null, adsetId: null, campaignId: null, isOrganic: true }),
    })

    expect(touchpointUpserts[0]).toMatchObject({
      attr_platform: 'meta',
      attr_ad_id: null,
      attr_campaign_id: null,
    })
    expect((touchpointUpserts[0].metadata as Record<string, unknown>).is_organic).toBe(true)
  })

  /**
   * 断链闭合的最后一跳：Meta 的 lead 接口不给 creative id，只能拿 ad_id 回查 ME 在
   * 建广告那一刻记下的对应关系。这条钉住「查到了就写进人和触点两处」。
   */
  it('拿 ad_id 回查得到片子 → 人和触点两处都写上 attr_creative_ref', async () => {
    mockDb({ creativeLinkRow: { creative_ref: 'wo-1' } })
    await ingestMetaLead({ clientId: CLIENT, defaultCountry: 'NZ', lead: lead() })

    expect(touchpointUpserts[0]).toMatchObject({ attr_ad_id: 'ad1', attr_creative_ref: 'wo-1' })
    expect(contactInserts[0]).toMatchObject({ attr_creative_ref: 'wo-1' })
  })

  /** 这条广告不是 ME 建的（或者建的时候就没认出片子）→ 照实留白，绝不拿别的片子顶上。 */
  it('回查不到片子 → attr_creative_ref 留 NULL', async () => {
    mockDb({ creativeLinkRow: null })
    await ingestMetaLead({ clientId: CLIENT, defaultCountry: 'NZ', lead: lead() })

    expect(touchpointUpserts[0]).toMatchObject({ attr_ad_id: 'ad1', attr_creative_ref: null })
  })

  it('「感兴趣的团」进 metadata.tour_interest_raw（CRM 横表那一列读它）', async () => {
    mockDb({})
    await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: lead({
        answers: [
          { name: 'email', value: 'chris@example.com' },
          { name: 'which_tour_interests_you_most?', value: 'Best of China' },
        ],
      }),
    })

    const row = touchpointUpserts[0]
    expect((row.metadata as Record<string, unknown>).tour_interest_raw).toBe('Best of China')
    expect(row.summary).toBe('填了 Facebook 表单 · Best of China')
  })

  it('AU 客户的本地号码补 +61，不是 +64', async () => {
    mockDb({})
    await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'AU',
      lead: lead({
        answers: [{ name: 'phone_number', value: '0412 345 678' }],
      }),
    })
    expect(contactInserts[0].primary_phone).toBe('+61412345678')
  })

  it('单条炸掉不抛异常，如实回报 error（一条脏 lead 不能停掉整批）', async () => {
    mockDb({})
    ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('db down')
    })

    const res = await ingestMetaLead({ clientId: CLIENT, defaultCountry: 'NZ', lead: lead() })
    expect(res).toMatchObject({ contactId: null, skipped: 'error', mailchimp: null })
  })
})

// ── Mailchimp 出口 ──────────────────────────────────────────────────────────
// 这些用例照着 Issue #1188 的 required regressions 逐条钉，每一条对应一种
// 真的会在生产里出现的形态。

/** Meta 表单里带一个 marketing consent 类型答案的 lead —— provable consent。 */
const consented = () =>
  lead({
    answers: [
      { name: 'full_name', value: 'Chris Brown' },
      { name: 'email', value: 'chris@example.com' },
      { name: 'phone_number', value: 'p:+6421363598' },
      // 明确肯定短值 —— 命中新的白名单（Yes / I agree / Subscribe / …）
      { name: 'consent_to_marketing_emails', value: 'Yes' },
    ],
  })

describe('ingestMetaLead → Mailchimp 出口', () => {
  it('R1 valid + consented + audience 已配 → 触发 subscribeMember，写 mailchimp_synced_at', async () => {
    mockDb({ audienceId: 'dda97b7e61' })
    subscribeMock.mockResolvedValueOnce({ status: 'subscribed' })

    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    expect(subscribeMock).toHaveBeenCalledTimes(1)
    expect(subscribeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        audienceId: 'dda97b7e61',
        email: 'chris@example.com',
        firstName: 'Chris',
        lastName: 'Brown',
        source: 'Meta Lead Form',
      }),
    )
    expect(res.mailchimp).toEqual({ status: 'subscribed' })

    // mailchimp_result 落进触点 metadata（不是新表）
    const meta = touchpointUpserts[0].metadata as Record<string, unknown>
    expect(meta.mailchimp_result).toEqual({ status: 'subscribed' })

    // contacts.mailchimp_synced_at 被写上，且是 ISO 字符串
    expect(contactUpdates).toHaveLength(1)
    expect(typeof contactUpdates[0].mailchimp_synced_at).toBe('string')
    expect(contactUpdates[0].mailchimp_synced_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('R2 Member Exists → 触点上如实记录，contacts.mailchimp_synced_at 也写，绝不重订阅', async () => {
    mockDb({ audienceId: 'dda97b7e61' })
    subscribeMock.mockResolvedValueOnce({ status: 'already_member' })

    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    expect(subscribeMock).toHaveBeenCalledTimes(1)
    // 只调用了一次 —— 不会为 already_member 再 PATCH 一次去重新订阅
    expect(res.mailchimp).toEqual({ status: 'already_member' })
    expect(contactUpdates).toHaveLength(1)
  })

  it('R3 provider 5xx → 主管道照常写入，synced_at 不写，触点里如实留 failed', async () => {
    mockDb({ audienceId: 'dda97b7e61' })
    subscribeMock.mockResolvedValueOnce({
      status: 'failed',
      reason: 'provider_5xx',
      providerStatus: 503,
    })

    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    // 主管道成了 —— 触点写了、contact 建了
    expect(touchpointUpserts).toHaveLength(1)
    expect(res.contactId).toBe('person-new')
    // 但 synced_at 没被碰 —— failed 不算「同步成功」
    expect(contactUpdates).toHaveLength(0)
    // 失败原因如实进 metadata
    const meta = touchpointUpserts[0].metadata as Record<string, unknown>
    expect(meta.mailchimp_result).toMatchObject({
      status: 'failed',
      reason: 'provider_5xx',
      providerStatus: 503,
    })
  })

  it('R4 客户没配 audience → 触点照常写，零 provider 调用', async () => {
    mockDb({ audienceId: null })

    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    expect(subscribeMock).not.toHaveBeenCalled()
    expect(touchpointUpserts).toHaveLength(1)
    expect(contactUpdates).toHaveLength(0)
    expect(res.mailchimp).toEqual({ status: 'skipped', reason: 'no_audience_config' })
  })

  it('R5 lead 没邮箱（只有电话） → 触点照常写，零 provider 调用', async () => {
    mockDb({ audienceId: 'dda97b7e61' })

    await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: lead({
        answers: [
          { name: 'full_name', value: 'Chris Brown' },
          { name: 'phone_number', value: '+6421363598' },
          { name: 'consent', value: 'yes' },
        ],
      }),
    })

    expect(subscribeMock).not.toHaveBeenCalled()
    const meta = touchpointUpserts[0].metadata as Record<string, unknown>
    expect(meta.mailchimp_result).toEqual({ status: 'skipped', reason: 'no_email' })
  })

  it('R7 没有 consent 类问答 → 零 provider 调用，reason=no_consent_evidence', async () => {
    mockDb({ audienceId: 'dda97b7e61' })

    // lead() 默认的 answers 里没有 consent 字段
    const res = await ingestMetaLead({ clientId: CLIENT, defaultCountry: 'NZ', lead: lead() })

    expect(subscribeMock).not.toHaveBeenCalled()
    expect(res.mailchimp).toEqual({ status: 'skipped', reason: 'no_consent_evidence' })
    expect(contactUpdates).toHaveLength(0)
  })

  it('consent 问题在但答案是「No」→ 视为未同意，零 provider 调用', async () => {
    mockDb({ audienceId: 'dda97b7e61' })

    await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: lead({
        answers: [
          { name: 'full_name', value: 'Chris Brown' },
          { name: 'email', value: 'chris@example.com' },
          { name: 'subscribe_to_newsletter', value: 'No' },
        ],
      }),
    })

    expect(subscribeMock).not.toHaveBeenCalled()
  })

  it('MAILCHIMP_API_KEY 未配置 → 零 provider 调用，reason=no_api_key', async () => {
    mockDb({ audienceId: 'dda97b7e61' })
    delete process.env.MAILCHIMP_API_KEY

    await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    expect(subscribeMock).not.toHaveBeenCalled()
    const meta = touchpointUpserts[0].metadata as Record<string, unknown>
    expect(meta.mailchimp_result).toEqual({ status: 'skipped', reason: 'no_api_key' })
  })

  /**
   * 隐私红线：Mailchimp 出口的观测栏**不能**回显邮箱、provider body 或 API key。
   * 只允许 status + reason（+ 数字 providerStatus）。
   */
  it('触点 metadata 里的 mailchimp_result 不含邮箱或 provider body', async () => {
    mockDb({ audienceId: 'dda97b7e61' })
    subscribeMock.mockResolvedValueOnce({
      status: 'failed',
      reason: 'validation',
      providerStatus: 400,
    })

    await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    const meta = touchpointUpserts[0].metadata as Record<string, unknown>
    const mc = meta.mailchimp_result as Record<string, unknown>
    const asString = JSON.stringify(mc)
    expect(asString).not.toContain('@')
    expect(asString).not.toContain('chris')
    expect(asString).not.toContain('test-key')
  })

  it('subscribeMember 意外抛异常时不会拖挂主管道', async () => {
    mockDb({ audienceId: 'dda97b7e61' })
    subscribeMock.mockRejectedValueOnce(new Error('boom'))

    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    expect(res.contactId).toBe('person-new')
    expect(res.skipped).toBeNull()
    expect(res.mailchimp).toEqual({ status: 'failed', reason: 'unexpected_exception' })
    expect(contactUpdates).toHaveLength(0)
  })

  it('查客户配置本身失败 → 出口 skipped: client_config_read_failed，不拖挂主管道', async () => {
    mockDb({ audienceId: null, clientReadError: 'timeout' })

    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    expect(subscribeMock).not.toHaveBeenCalled()
    expect(res.mailchimp).toEqual({ status: 'skipped', reason: 'client_config_read_failed' })
    expect(res.contactId).toBe('person-new')
  })
})

// ── Remediation P1 `PRRT_kwDOSTHiF86cIG3H`：统一 DNC 判据 fail-closed ────────
// 每条都要保证：主管道（contact + touchpoint）仍然写成功；只有出口被拦。

describe('ingestMetaLead → 统一 DNC 判据 fail-closed', () => {
  it('明确 opt-out 表单答案 → 出口 skipped: explicit_opt_out，零 provider 调用；主管道照常', async () => {
    mockDb({ audienceId: 'dda97b7e61' })

    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: lead({
        answers: [
          { name: 'full_name', value: 'Chris Brown' },
          { name: 'email', value: 'chris@example.com' },
          { name: 'consent', value: 'Yes' },
          { name: 'marketing_opt_out', value: 'Yes' },
        ],
      }),
    })

    expect(subscribeMock).not.toHaveBeenCalled()
    expect(res.mailchimp).toEqual({ status: 'skipped', reason: 'explicit_opt_out' })
    // 主管道成了
    expect(touchpointUpserts).toHaveLength(1)
    expect(contactInserts).toHaveLength(1)
    // synced_at 不写
    expect(contactUpdates).toHaveLength(0)
  })

  it('contacts.do_not_contact=true → 出口 skipped: contact_dnc，零 provider 调用', async () => {
    mockDb({ audienceId: 'dda97b7e61', contactDncFlag: true })

    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    expect(subscribeMock).not.toHaveBeenCalled()
    expect(res.mailchimp).toEqual({ status: 'skipped', reason: 'contact_dnc' })
    expect(touchpointUpserts).toHaveLength(1) // 主管道照常
    expect(contactUpdates).toHaveLength(0)
  })

  it('镜像列 false 但触点里有跨渠道拒联证据 → 出口 skipped: contact_dnc', async () => {
    mockDb({
      audienceId: 'dda97b7e61',
      contactDncFlag: false,
      // 电话渠道上有人明确说别再联系 —— 跨渠道，Mailchimp 出口也得拦
      existingDncTouches: [
        { outcome: 'do_not_contact', occurred_at: '2026-08-01T10:00:00Z' },
      ],
    })

    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    expect(subscribeMock).not.toHaveBeenCalled()
    expect(res.mailchimp).toEqual({ status: 'skipped', reason: 'contact_dnc' })
  })

  it('触点里 metadata.do_not_contact=true 也算（不是只看 outcome）', async () => {
    mockDb({
      audienceId: 'dda97b7e61',
      existingDncTouches: [
        { do_not_contact: true, occurred_at: '2026-08-01T10:00:00Z' },
      ],
    })

    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    expect(subscribeMock).not.toHaveBeenCalled()
    expect(res.mailchimp).toEqual({ status: 'skipped', reason: 'contact_dnc' })
  })

  it('DNC 触点读失败 → 出口 skipped: dnc_check_failed（fail-closed，不猜「没有」）', async () => {
    mockDb({ audienceId: 'dda97b7e61', touchpointReadError: 'timeout' })

    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    expect(subscribeMock).not.toHaveBeenCalled()
    expect(res.mailchimp).toEqual({ status: 'skipped', reason: 'dnc_check_failed' })
    // 主管道照常
    expect(touchpointUpserts).toHaveLength(1)
  })

  it('DNC contact 读失败 → 出口 skipped: dnc_check_failed', async () => {
    mockDb({ audienceId: 'dda97b7e61', contactReadError: 'db down' })

    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    expect(subscribeMock).not.toHaveBeenCalled()
    expect(res.mailchimp).toEqual({ status: 'skipped', reason: 'dnc_check_failed' })
  })

  it('历史 do_not_contact 触点已被明确 dnc_cleared 判决晚于其后 → 出口正常放行', async () => {
    mockDb({
      audienceId: 'dda97b7e61',
      contactDncFlag: true, // 镜像列可能还是旧值 —— 判据看的是最后一次判决
      existingDncTouches: [
        { outcome: 'do_not_contact', occurred_at: '2026-07-01T10:00:00Z' },
        { outcome: 'dnc_cleared', occurred_at: '2026-08-15T10:00:00Z' },
      ],
    })
    subscribeMock.mockResolvedValueOnce({ status: 'subscribed' })

    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    expect(subscribeMock).toHaveBeenCalledTimes(1)
    expect(res.mailchimp).toEqual({ status: 'subscribed' })
  })

  it('新 lead consent 不自动覆盖历史 DNC —— 没有 dnc_cleared 触点时照样拦', async () => {
    // 表单里的 consent = Yes；触点里有陈年 do_not_contact；但从没被人明确纠正过
    mockDb({
      audienceId: 'dda97b7e61',
      existingDncTouches: [
        { outcome: 'do_not_contact', occurred_at: '2026-06-01T10:00:00Z' },
      ],
    })

    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    expect(subscribeMock).not.toHaveBeenCalled()
    expect(res.mailchimp).toEqual({ status: 'skipped', reason: 'contact_dnc' })
  })
})
