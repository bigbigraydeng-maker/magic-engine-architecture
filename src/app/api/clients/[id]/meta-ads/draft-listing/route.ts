/**
 * POST /api/clients/[id]/meta-ads/draft-listing
 *
 * 拿**已核实的房源／中介事实** → 生成草案 → 建成暂停 → 过闸门 → 等人点头。
 * 这是「ME 发广告」那条链路缺的上游调用方。
 *
 * ── 事实必须由调用方带来，这个接口不去猜 ────────────────────────────────
 * 铁律 8：房源信息只认客户官网／房源系统，不认 master_brief。所以请求体里
 * 每组事实都必须带 `sourceUrl`；缺了 `listing-draft-builder` 会直接抛。
 *
 * ── 表单 id 在服务端解析，不由请求体指定 ────────────────────────────────
 * 让调用方传表单 id 等于开了一个「往别人的表单里灌客资」的口子。这里一律
 * 从该客户自己的主页上取。
 *
 * Body:
 *   kind        'lead_form' | 'video_thruplay'
 *   lang        'zh' | 'en'
 *   listing     ListingFacts（lead_form 必给）
 *   agent       AgentFacts
 *   dailyBudget / durationDays / geoCountries …
 *   imageHash / videoId  素材（要先传到 Meta）
 *   formName?   指定用哪个表单（按名字匹配）；不给就用唯一一个 active 表单
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { fetchPageLeadForms } from '@/lib/meta/lead-forms'
import {
  buildBuyerLeadDraft,
  buildSellerThruPlayDraft,
  traceClaims,
  NotGroundedError,
  type ListingFacts,
  type AgentFacts,
  type BuildOptions,
  type AdLang,
} from '@/lib/ads-strategy/listing-draft-builder'
import { createDraftForApproval } from '@/lib/ads-strategy/draft-and-gate'

export const maxDuration = 120

interface Body {
  kind?: 'lead_form' | 'video_thruplay'
  lang?: AdLang
  listing?: ListingFacts
  agent?: AgentFacts
  dailyBudget?: number
  durationDays?: number
  geoCountries?: string[]
  geoCityKeys?: string[]
  ageMin?: number
  ageMax?: number
  imageHash?: string
  videoId?: string
  linkUrl?: string
  formName?: string
}

/**
 * 挑一个表单。
 *
 * 有多个 active 表单又没指定名字时**报错而不是随便挑一个** —— 挑错了客资就流进
 * 别的表单，而且完全静默。
 */
function pickForm(
  forms: { formId: string; name: string | null; status: string | null }[],
  wanted?: string,
): { formId: string } | { error: string } {
  const active = forms.filter((f) => (f.status ?? '').toUpperCase() === 'ACTIVE')
  const pool = active.length > 0 ? active : forms

  if (wanted) {
    const hit = pool.filter((f) => (f.name ?? '').includes(wanted))
    if (hit.length === 1) return { formId: hit[0].formId }
    if (hit.length === 0) return { error: `这个主页上没有名字含「${wanted}」的表单` }
    return { error: `名字含「${wanted}」的表单有 ${hit.length} 个，说清楚是哪一个` }
  }

  if (pool.length === 0) return { error: '这个主页上一个即时表单都没有 —— 要先在 Meta 里建一个' }
  if (pool.length > 1) {
    return {
      error:
        `这个主页上有 ${pool.length} 个表单（${pool
          .map((f) => f.name ?? f.formId)
          .join('、')}），没说用哪个。挑错了客资会静默流进别的表单，所以不猜。`,
    }
  }
  return { formId: pool[0].formId }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: clientId } = await params

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.agent) return NextResponse.json({ error: '没给中介事实（agent）' }, { status: 400 })
  const kind = body.kind ?? 'lead_form'
  const lang: AdLang = body.lang ?? 'en'

  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('meta_ad_account_id, facebook_page_id, country')
    .eq('id', clientId)
    .maybeSingle()

  const c = client as {
    meta_ad_account_id?: string
    facebook_page_id?: string
    country?: string
  } | null

  if (!c?.meta_ad_account_id) {
    return NextResponse.json({ error: '这个客户还没配广告账户' }, { status: 424 })
  }
  if (!c.facebook_page_id) {
    return NextResponse.json({ error: '这个客户还没配主页' }, { status: 424 })
  }

  const accessToken = await getMetaTokenForClient(clientId)
  if (!accessToken) {
    return NextResponse.json({ error: '拿不到这个客户的 Meta 授权' }, { status: 424 })
  }

  const opts: BuildOptions = {
    clientId,
    pageId: c.facebook_page_id,
    lang,
    dailyBudget: body.dailyBudget ?? 25,
    durationDays: body.durationDays ?? 7,
    geoCountries: body.geoCountries ?? (c.country ? [c.country] : []),
    geoCityKeys: body.geoCityKeys,
    ageMin: body.ageMin,
    ageMax: body.ageMax,
    imageHash: body.imageHash,
    videoId: body.videoId,
    linkUrl: body.linkUrl,
  }

  // 表单只在真要用的时候去解析 —— 养受众那条不需要表单，别为它多打一次 Graph。
  if (kind === 'lead_form') {
    const { rows, error } = await fetchPageLeadForms(c.facebook_page_id, accessToken)
    if (error) {
      return NextResponse.json({ error: `读不到这个主页的表单：${error}` }, { status: 424 })
    }
    const picked = pickForm(rows, body.formName)
    if ('error' in picked) return NextResponse.json({ error: picked.error }, { status: 422 })
    opts.leadFormId = picked.formId
  }

  let draft
  try {
    draft =
      kind === 'lead_form'
        ? buildBuyerLeadDraft(body.listing as ListingFacts, body.agent, opts)
        : buildSellerThruPlayDraft(body.agent, opts)
  } catch (err) {
    if (err instanceof NotGroundedError) {
      return NextResponse.json({ error: err.message, notGrounded: true }, { status: 422 })
    }
    throw err
  }

  const outcome = await createDraftForApproval(draft, {
    supabase: supabaseAdmin,
    adAccountId: c.meta_ad_account_id,
    accessToken,
    expectedGeo: c.country ?? null,
  })

  return NextResponse.json({
    ...outcome,
    // 逐句可溯来源随交付一起给出 —— 红线要求，不是调试信息。
    claims: traceClaims(draft, {
      listing: kind === 'lead_form' ? (body.listing as ListingFacts) : undefined,
      agent: body.agent as AgentFacts,
    }),
  })
}
