import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAccounts, uploadMediaFromUrl, schedulePost } from '@/lib/publer/client'
import { getAdapter } from '@/lib/flywheel/adapters/registry'
import { SOCIAL_ACTION_TYPE } from '@/lib/flywheel/vocabulary'
import { judgeOutgoingPost, priceGateMessage } from '@/lib/content/price-claim-gate'
import '@/lib/flywheel/adapters/SocialContentAdapter'

// POST /api/publer/create-post
// 自动化流程用：Airtable approved → webhook → 这里
// 用 post_id 找最新 ready 素材，自动选第一个匹配平台的 Publer 账号
//
// Auth: Bearer ${PUBLER_CREATE_POST_TOKEN}
// P21.J.SEC-2：这条接口至今无鉴权——任何人拿一个 post_id 就能把该客户的
// 成片发到他的社媒账号。不能像 schedule/draft/[assetId] 那样直接加登录鉴权，
// 因为这条同时被 Zapier/Airtable webhook 调用（只带 body 的 post_id，没有
// 会话），加了登录鉴权会当场打断线上自动化。同一个密钥要配进 Zapier/Airtable
// 那边的 webhook header，这一步需要 PM/知道 Zapier 后台的人动手配一次
// （代码这边做不了，见交接说明）。
export async function POST(req: NextRequest) {
  const expectedToken = process.env.PUBLER_CREATE_POST_TOKEN
  if (!expectedToken) {
    return NextResponse.json(
      { success: false, error: 'Server misconfiguration: PUBLER_CREATE_POST_TOKEN not set' },
      { status: 500 },
    )
  }
  if (req.headers.get('authorization') !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { post_id, schedule_at } = await req.json()
    if (!post_id) {
      return NextResponse.json({ success: false, error: 'post_id required' }, { status: 400 })
    }

    const { data: post } = await supabaseAdmin
      .from('content_posts')
      .select('id, client_id, caption, script, hashtags, platforms, status')
      .eq('id', post_id)
      .single()

    if (!post) return NextResponse.json({ success: false, error: 'Post not found' }, { status: 404 })
    if (post.status !== 'approved') {
      return NextResponse.json({ success: false, error: 'Post not approved' }, { status: 400 })
    }

    // Prefer is_final=true assets (externally edited final versions),
    // then fall back to most recently selected/created ready asset
    const { data: assets } = await supabaseAdmin
      .from('visual_assets')
      .select('id, storage_url, asset_type, is_final, current_version_num')
      .eq('post_id', post_id)
      .eq('generation_status', 'ready')
      .order('is_final', { ascending: false })
      .order('is_selected', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)

    const asset = assets?.[0]
    if (!asset?.storage_url) {
      return NextResponse.json({ success: false, error: 'No ready asset found' }, { status: 400 })
    }

    // Look up client's configured Publer account IDs (set via Connectors > Publer)
    const { data: connectorRow } = await supabaseAdmin
      .from('client_connectors')
      .select('config')
      .eq('client_id', post.client_id)
      .eq('anchor', 'publer')
      .maybeSingle()

    // Runtime-validate the JSONB shape before trusting it
    const rawConfig = connectorRow?.config
    const rawIds =
      rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig)
        ? (rawConfig as Record<string, unknown>).publer_account_ids
        : undefined
    const configuredIds: Record<string, string> =
      rawIds && typeof rawIds === 'object' && !Array.isArray(rawIds)
        ? (rawIds as Record<string, string>)
        : {}

    const accounts = await getAccounts()
    const postPlatforms: string[] = Array.isArray(post.platforms)
      ? post.platforms
      : (post.platforms ? [post.platforms] : [])

    // Normalise platform strings to lowercase to match Publer's provider field
    const platforms = postPlatforms.map(p => p.toLowerCase())

    let account: typeof accounts[0] | undefined

    // If connector is configured, use the bound account — fail if it's stale
    const configuredPlatform = platforms.find(p => configuredIds[p])
    if (configuredPlatform) {
      account = accounts.find(a => a.id === configuredIds[configuredPlatform])
      if (!account) {
        return NextResponse.json({
          success: false,
          error: `Publer account binding for "${configuredPlatform}" is stale. Please reconfigure the Publishing Hub connector for this client.`,
        }, { status: 400 })
      }
    } else {
      // Connector not yet configured — fall back to first platform match (backward compat)
      account = platforms.length > 0
        ? accounts.find(a => platforms.includes(a.provider?.toLowerCase() ?? '')) ?? accounts[0]
        : accounts[0]
    }

    if (!account) {
      return NextResponse.json({ success: false, error: 'No Publer account found' }, { status: 400 })
    }

    const hashtags = post.hashtags ? `\n\n${post.hashtags}` : ''
    const caption = `${post.caption || post.script || ''}${hashtags}`.trim()

    // 真价只配真画面 —— 这条是**自动发布**路径（Airtable 审批过就跑），人不在场，
    // 所以这里是东西出去前的最后一道闸。拦下后本条留在 approved 不动，
    // 由今日待办的「🙋 需要你动手」把它捞出来（loadManualItems → pushPriceGateItems），
    // 不让它烂在 webhook 的错误日志里。
    const verdict = await judgeOutgoingPost(supabaseAdmin, {
      clientId: post.client_id,
      caption,
      imageUrl: asset.storage_url,
    })
    if (verdict.blocked) {
      console.error(`[publer/create-post] 价格闸拦下 post ${post_id}: ${priceGateMessage(verdict.source)}`)
      return NextResponse.json(
        { success: false, error: priceGateMessage(verdict.source), code: 'price_claim_unbacked' },
        { status: 409 },
      )
    }

    const scheduledAt = schedule_at ?? new Date(Date.now() + 3600_000).toISOString()
    const fileName = asset.storage_url.split('/').pop() ?? 'media'
    const media = await uploadMediaFromUrl(asset.storage_url, fileName)

    const result = await schedulePost({
      accountId: account.id,
      provider: account.provider,
      assetType: asset.asset_type,
      media,
      caption,
      scheduledAt,
    })

    await supabaseAdmin
      .from('content_posts')
      .update({
        status: 'scheduled',
        publer_post_id: result.job_id,
        scheduled_at: scheduledAt,
      })
      .eq('id', post_id)

    // Fire-and-forget: write social flywheel action (non-fatal)
    getAdapter('social').execute({
      clientId: post.client_id,
      actionType:    SOCIAL_ACTION_TYPE.SCHEDULE_POST,
      executionMode: 'third_party',
      vendor:        'publer',
      payload: {
        post_id,
        publer_job_id: result.job_id,
        platform:      account.provider,
        scheduled_at:  scheduledAt,
      },
    }).catch((err: unknown) => {
      console.error('[publer/create-post] flywheel write failed:', err)
    })

    return NextResponse.json({ success: true, job_id: result.job_id, client_id: post.client_id })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[publer/create-post]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
