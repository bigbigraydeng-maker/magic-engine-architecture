import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { CampaignDailyCommandSchema, CAMPAIGN_DAILY_PLAN_KIND, type CampaignDailyPlanData } from '@/lib/campaign/daily-plan'
import {
  addCalendarDays,
  assertCompleteConsecutiveWindow,
  campaignDailyReviewStableKey,
  dateInTimeZone,
  deterministicReviewUuid,
  isRealIsoDate,
  refreshCampaignDailyPlan,
  type RefreshedCampaignDailyPlan,
} from '@/lib/campaign/daily-plan-review'
import { getClientLocale } from '@/lib/locale/client-locale'
import { supabaseAdmin } from '@/lib/supabase'

const uuidLike = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
const RequestSchema = z.object({
  campaign_id: uuidLike,
  plan_id: uuidLike,
  expected_revision: z.string().datetime({ offset: true }),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict()

type JsonObject = Record<string, unknown>

function failure(error: string, status: number, details?: JsonObject) {
  return NextResponse.json({ success: false, error, ...details }, { status })
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isoIsAfter(left: string | null | undefined, right: string): boolean {
  if (!left) return true
  const leftMs = Date.parse(left)
  const rightMs = Date.parse(right)
  return Number.isNaN(leftMs) || Number.isNaN(rightMs) || leftMs > rightMs
}

function postCaption(post: NonNullable<CampaignDailyPlanData['bundles'][number]['post']>): string {
  return `${post.hook}\n\n${post.body}\n\n${post.cta}\n${post.cta_url}`.trim()
}

/**
 * Refresh an already-grounded seven-day plan and hand only its seven Facebook
 * Posts to the existing human review board. No provider, worker, scheduler,
 * Story/Reel row, execution item or publishing adapter is called here.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const clientId = params.id
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return failure(access.error, access.status, access.reason ? { reason: access.reason } : undefined)
  }

  const raw = await req.json().catch(() => null)
  const parsed = RequestSchema.safeParse(raw)
  if (!parsed.success || !isRealIsoDate(parsed.data?.start_date ?? '')) {
    return failure('INVALID_REQUEST', 400, {
      details: parsed.success ? { start_date: ['Must be a real YYYY-MM-DD date'] } : parsed.error.flatten(),
    })
  }
  const input = parsed.data

  try {
    const { data: planRow, error: planError } = await supabaseAdmin
      .from('social_plans')
      .select('id, client_id, campaign_id, plan_data, created_at')
      .eq('client_id', clientId)
      .eq('campaign_id', input.campaign_id)
      .contains('plan_data', { plan_kind: CAMPAIGN_DAILY_PLAN_KIND })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (planError) throw planError
    if (!planRow || planRow.id !== input.plan_id) return failure('LATEST_PLAN_NOT_FOUND', 404)

    const plan = planRow.plan_data as CampaignDailyPlanData
    if (
      plan.plan_kind !== CAMPAIGN_DAILY_PLAN_KIND ||
      plan.campaign_id !== input.campaign_id ||
      plan.command_meta?.received_at !== input.expected_revision
    ) {
      return failure('STALE_PLAN_REVISION', 409)
    }

    const snapshotCheck = CampaignDailyCommandSchema.safeParse({
      campaign_id: plan.campaign_id,
      days: plan.days,
      bundles: plan.bundles,
      raw_summary: plan.command_meta.raw_summary,
    })
    if (!snapshotCheck.success) {
      return failure('PLAN_NOT_HANDOFF_READY', 409, { details: snapshotCheck.error.flatten() })
    }
    assertCompleteConsecutiveWindow(plan.days, plan.bundles)
    if (plan.refresh_meta && (
      !isRealIsoDate(plan.refresh_meta.start_date) ||
      !isRealIsoDate(plan.refresh_meta.end_date) ||
      !Array.isArray(plan.refresh_meta.original_dates) ||
      plan.refresh_meta.original_dates.length !== 7 ||
      plan.refresh_meta.original_dates.some((date, index) =>
        !isRealIsoDate(date) || date !== addCalendarDays(plan.refresh_meta!.original_dates[0], index)
      ) ||
      plan.days[0].date !== plan.refresh_meta.start_date ||
      plan.days[6].date !== plan.refresh_meta.end_date ||
      plan.refresh_meta.end_date !== addCalendarDays(plan.refresh_meta.start_date, 6)
    )) {
      return failure('PLAN_NOT_HANDOFF_READY', 409)
    }

    const [{ data: campaign, error: campaignError }, locale, { data: activeBrief, error: briefError }] = await Promise.all([
      supabaseAdmin
        .from('campaign_briefs')
        .select('id, client_id, status, source_urls, valid_from, valid_until, updated_at')
        .eq('id', input.campaign_id)
        .eq('client_id', clientId)
        .maybeSingle(),
      getClientLocale(clientId),
      supabaseAdmin
        .from('master_briefs')
        .select('id, version, updated_at')
        .eq('client_id', clientId)
        .or('status.eq.active,is_active.eq.true')
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    if (campaignError) throw campaignError
    if (briefError) throw briefError
    if (!campaign) return failure('CAMPAIGN_NOT_FOUND', 404)
    if (campaign.status !== 'active') return failure('CAMPAIGN_NOT_ACTIVE', 409)

    const localToday = dateInTimeZone(new Date(), locale.timezone)
    const endDate = addCalendarDays(input.start_date, 6)
    if (input.start_date <= localToday) {
      return failure('START_DATE_MUST_BE_FUTURE', 400, { local_today: localToday, timezone: locale.timezone })
    }
    if (
      (campaign.valid_from && input.start_date < campaign.valid_from) ||
      (campaign.valid_until && endDate > campaign.valid_until)
    ) {
      return failure('WINDOW_OUTSIDE_CAMPAIGN', 409, {
        campaign_valid_from: campaign.valid_from,
        campaign_valid_until: campaign.valid_until,
      })
    }

    const savedBrief = plan.master_brief_ref
    if (
      !savedBrief ||
      !activeBrief ||
      savedBrief.id !== activeBrief.id ||
      savedBrief.version !== (activeBrief.version ?? null) ||
      isoIsAfter(activeBrief.updated_at, input.expected_revision) ||
      isoIsAfter(campaign.updated_at, input.expected_revision)
    ) {
      return failure('STALE_GROUNDING', 409)
    }

    const campaignSourceUrl = Array.isArray(campaign.source_urls) ? campaign.source_urls[0] : null
    if (!campaignSourceUrl) return failure('CAMPAIGN_HAS_NO_CTA_SOURCE_URL', 409)
    const mismatchedCtas = plan.bundles.filter(bundle => bundle.post?.cta_url !== campaignSourceUrl)
    if (mismatchedCtas.length > 0) {
      return failure('CTA_URL_MISMATCH', 409, { dates: mismatchedCtas.map(bundle => bundle.date) })
    }

    const imageIds = plan.bundles.map(bundle => bundle.post?.image_asset_id ?? '')
    if (imageIds.some(id => !id) || new Set(imageIds).size !== 7) {
      return failure('POST_IMAGE_INVALID', 409)
    }
    const { data: assetRows, error: assetError } = await supabaseAdmin
      .from('client_assets')
      .select('id, client_id, storage_url, original_filename, status, archived_at, mime_type')
      .eq('client_id', clientId)
      .in('id', imageIds)
    if (assetError) throw assetError
    const assetById = new Map((assetRows ?? []).map(asset => [asset.id, asset]))
    const invalidImages = imageIds.filter(id => {
      const asset = assetById.get(id)
      return !asset || asset.status !== 'analyzed' || asset.archived_at != null ||
        !asset.mime_type?.startsWith('image/') || !asset.storage_url
    })
    if (invalidImages.length > 0) {
      return failure('POST_IMAGE_INVALID', 409, { image_asset_ids: invalidImages })
    }

    if (plan.refresh_meta && plan.refresh_meta.start_date !== input.start_date) {
      return failure('PLAN_ALREADY_HANDED_OFF', 409, { start_date: plan.refresh_meta.start_date })
    }

    let refreshed: RefreshedCampaignDailyPlan
    if (plan.refresh_meta) {
      refreshed = plan as RefreshedCampaignDailyPlan
    } else {
      refreshed = refreshCampaignDailyPlan(plan, input.start_date, new Date().toISOString())
      const { data: updated, error: updateError } = await supabaseAdmin
        .from('social_plans')
        .update({ plan_data: refreshed })
        .eq('id', input.plan_id)
        .eq('client_id', clientId)
        .eq('campaign_id', input.campaign_id)
        .contains('plan_data', { command_meta: { received_at: input.expected_revision } })
        .is('plan_data->refresh_meta', null)
        .select('id')
        .maybeSingle()
      if (updateError) throw updateError
      if (!updated) {
        const { data: raced, error: racedError } = await supabaseAdmin
          .from('social_plans')
          .select('plan_data')
          .eq('id', input.plan_id)
          .eq('client_id', clientId)
          .maybeSingle()
        if (racedError) throw racedError
        const racedPlan = raced?.plan_data as RefreshedCampaignDailyPlan | undefined
        if (
          racedPlan?.plan_kind !== CAMPAIGN_DAILY_PLAN_KIND ||
          racedPlan.campaign_id !== input.campaign_id ||
          racedPlan.command_meta?.received_at !== input.expected_revision ||
          racedPlan.refresh_meta?.start_date !== input.start_date
        ) {
          return failure('PLAN_REFRESH_CONFLICT', 409)
        }
        const racedSnapshot = CampaignDailyCommandSchema.safeParse({
          campaign_id: racedPlan.campaign_id,
          days: racedPlan.days,
          bundles: racedPlan.bundles,
          raw_summary: racedPlan.command_meta.raw_summary,
        })
        if (!racedSnapshot.success) return failure('PLAN_REFRESH_CONFLICT', 409)
        try {
          assertCompleteConsecutiveWindow(racedPlan.days, racedPlan.bundles)
        } catch {
          return failure('PLAN_REFRESH_CONFLICT', 409)
        }
        refreshed = racedPlan
      }
    }

    const postRows = refreshed.bundles.map((bundle, dayIndex) => {
      const post = bundle.post!
      const stableKey = campaignDailyReviewStableKey({
        clientId,
        planId: input.plan_id,
        planRevision: input.expected_revision,
        dayIndex,
      })
      return {
        id: deterministicReviewUuid('post', stableKey),
        client_id: clientId,
        campaign_id: input.campaign_id,
        content_mode: 'campaign',
        source_brief_id: savedBrief.id,
        title: post.hook,
        route: 'route_a',
        platforms: ['facebook'],
        script: null,
        caption: postCaption(post),
        hashtags: [],
        visual_brief: null,
        status: 'draft',
        scheduled_at: null,
        published_at: null,
        publer_post_id: null,
        generation_context_snapshot: {
          campaign_daily_v1: {
            identity: stableKey,
            plan_id: input.plan_id,
            plan_revision: input.expected_revision,
            campaign_id: input.campaign_id,
            day_index: dayIndex,
            original_date: refreshed.refresh_meta.original_dates[dayIndex],
            review_date: bundle.date,
            image_asset_id: post.image_asset_id,
            cta: { label: post.cta, url: post.cta_url },
          },
        },
      }
    })
    const visualRows = refreshed.bundles.map((bundle, dayIndex) => {
      const stableKey = campaignDailyReviewStableKey({
        clientId,
        planId: input.plan_id,
        planRevision: input.expected_revision,
        dayIndex,
      })
      const postId = deterministicReviewUuid('post', stableKey)
      const libraryAsset = assetById.get(bundle.post!.image_asset_id)!
      return {
        id: deterministicReviewUuid('image', stableKey),
        post_id: postId,
        client_id: clientId,
        asset_type: 'image',
        provider: 'client_library',
        // Pin the source asset ID in a field the existing table already owns.
        // This lets a retry distinguish the intended library reference from a
        // deterministic-ID collision without adding a schema column.
        prompt_used: `Campaign daily plan client_asset_id:${libraryAsset.id}; filename:${libraryAsset.original_filename ?? 'UNKNOWN'}`,
        variant: 1,
        generation_status: 'ready',
        storage_url: libraryAsset.storage_url,
        cost_usd: 0,
        is_selected: true,
        is_final: true,
        current_version_num: 1,
      }
    })

    const { data: insertedPosts, error: postInsertError } = await supabaseAdmin
      .from('content_posts')
      .upsert(postRows, { onConflict: 'id', ignoreDuplicates: true })
      .select('id')
    if (postInsertError) throw postInsertError

    // Verify the deterministic Post identities BEFORE linking images. If a
    // UUID were already occupied by unrelated lineage, we stop here instead
    // of attaching this client's image to somebody else's Post.
    const postIds = postRows.map(row => row.id)
    const { data: finalPosts, error: finalPostError } = await supabaseAdmin
      .from('content_posts')
      .select('id, client_id, campaign_id, content_mode, source_brief_id, title, route, platforms, caption, status, scheduled_at, published_at, publer_post_id, generation_context_snapshot')
      .in('id', postIds)
    if (finalPostError) throw finalPostError
    const postById = new Map((finalPosts ?? []).map(post => [post.id, post]))
    const lineageOk = postRows.every((expected, dayIndex) => {
      const actual = postById.get(expected.id)
      const snapshot = actual?.generation_context_snapshot as {
        campaign_daily_v1?: {
          identity?: string
          plan_id?: string
          plan_revision?: string
          campaign_id?: string
          day_index?: number
          original_date?: string
          review_date?: string
          image_asset_id?: string
          cta?: { label?: string; url?: string }
        }
      } | null
      const expectedSnapshot = expected.generation_context_snapshot.campaign_daily_v1
      const actualLineage = snapshot?.campaign_daily_v1
      const stableKey = campaignDailyReviewStableKey({
        clientId,
        planId: input.plan_id,
        planRevision: input.expected_revision,
        dayIndex,
      })
      const immutableFieldsOk = actual?.client_id === clientId &&
        actual?.campaign_id === input.campaign_id &&
        actual?.content_mode === 'campaign' &&
        actual?.source_brief_id === savedBrief.id &&
        actual?.route === 'route_a' &&
        Array.isArray(actual?.platforms) &&
        actual.platforms.length === 1 &&
        actual.platforms[0] === 'facebook'
      const lineageFieldsOk = actualLineage?.identity === stableKey &&
        actualLineage.plan_id === expectedSnapshot.plan_id &&
        actualLineage.plan_revision === expectedSnapshot.plan_revision &&
        actualLineage.campaign_id === expectedSnapshot.campaign_id &&
        actualLineage.day_index === expectedSnapshot.day_index &&
        actualLineage.original_date === expectedSnapshot.original_date &&
        actualLineage.review_date === expectedSnapshot.review_date &&
        actualLineage.image_asset_id === expectedSnapshot.image_asset_id &&
        actualLineage.cta?.label === expectedSnapshot.cta.label &&
        actualLineage.cta?.url === expectedSnapshot.cta.url
      const insertedNow = (insertedPosts ?? []).some(row => row.id === expected.id)
      const freshInsertOk = !insertedNow || (
        actual?.title === expected.title &&
        actual?.caption === expected.caption &&
        actual?.status === 'draft' &&
        actual?.scheduled_at == null &&
        actual?.published_at == null &&
        actual?.publer_post_id == null
      )
      return immutableFieldsOk && lineageFieldsOk && freshInsertOk
    })
    if ((finalPosts ?? []).length !== 7 || !lineageOk) {
      return failure('LINEAGE_ID_COLLISION', 409)
    }

    const { data: insertedImages, error: imageInsertError } = await supabaseAdmin
      .from('visual_assets')
      .upsert(visualRows, { onConflict: 'id', ignoreDuplicates: true })
      .select('id')
    if (imageInsertError) throw imageInsertError

    const visualIds = visualRows.map(row => row.id)
    const { data: finalImages, error: finalImageError } = await supabaseAdmin
      .from('visual_assets')
      .select('id, post_id, client_id, asset_type, provider, prompt_used, generation_status, storage_url, is_selected, is_final, current_version_num')
      .in('id', visualIds)
    if (finalImageError) throw finalImageError

    const imageById = new Map((finalImages ?? []).map(image => [image.id, image]))
    const imagesOk = visualRows.every(expected => {
      const actual = imageById.get(expected.id)
      return actual?.client_id === clientId &&
        actual?.post_id === expected.post_id &&
        actual?.asset_type === expected.asset_type &&
        actual?.provider === expected.provider &&
        actual?.prompt_used === expected.prompt_used &&
        actual?.generation_status === expected.generation_status &&
        actual?.storage_url === expected.storage_url &&
        actual?.is_selected === expected.is_selected &&
        actual?.is_final === expected.is_final &&
        actual?.current_version_num === expected.current_version_num
    })
    if ((finalImages ?? []).length !== 7 || !imagesOk) {
      return failure('LINEAGE_ID_COLLISION', 409)
    }

    return NextResponse.json({
      success: true,
      plan_id: input.plan_id,
      campaign_id: input.campaign_id,
      window: { start_date: input.start_date, end_date: endDate },
      posts: {
        created: insertedPosts?.length ?? 0,
        existing: 7 - (insertedPosts?.length ?? 0),
        ids: postRows.map((row, dayIndex) => ({
          id: row.id,
          day_index: dayIndex,
          date: refreshed.bundles[dayIndex].date,
          image_asset_id: refreshed.bundles[dayIndex].post!.image_asset_id,
        })),
      },
      images_linked: 7,
      images_created: insertedImages?.length ?? 0,
      review_path: `/dashboard/content?client=${encodeURIComponent(clientId)}&status=draft&highlight=${postRows[0].id}`,
      publishing_authorization: 'NOT_AUTHORIZED',
    })
  } catch (error) {
    const message = messageOf(error)
    if (message === 'PLAN_DATES_NOT_CONSECUTIVE' || message === 'PLAN_NOT_HANDOFF_READY') {
      return failure(message, 409)
    }
    console.error('[campaign-daily-plan/save-posts-to-board]', error)
    return failure('REVIEW_HANDOFF_FAILED', 500)
  }
}
