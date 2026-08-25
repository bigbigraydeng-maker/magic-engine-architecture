/**
 * GET  /api/clients/[id]/campaign-daily-plan?campaign_id=<uuid>
 *
 * Read-only projection: Master Brief/Campaign grounding, the seven-day
 * Post/Story/Reel slot grid, every persisted day's bundle (so Ray can select
 * any populated date, not just "today"), source asset provenance and
 * factual readiness gates per day. Publishing/ad status is always
 * NOT_AUTHORIZED — WP1 makes zero provider/publisher/worker calls.
 *
 * POST /api/clients/[id]/campaign-daily-plan
 *
 * Conversation-command persistence seam (WP1 §A). The agent (Claude/Codex)
 * interprets Ray's spoken instruction into a normalised ME_CONTENT_COMMAND_V1
 * -shaped payload; this route only validates and persists structured facts —
 * it never calls an LLM/provider itself.
 *
 * Storage: reuses `social_plans` (jsonb `plan_data`, no migration) tagged
 * `plan_kind: 'campaign_daily_v1'`.
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { getCampaignById } from '@/lib/content/campaign-injector'
import {
  CAMPAIGN_DAILY_PLAN_KIND,
  CampaignDailyCommandSchema,
  computeGrounding,
  computeReadiness,
  buildPublishingPlan,
  buildAdCandidate,
  buildEmptyDays,
  todayIso,
  type CampaignDailyPlanData,
} from '@/lib/campaign/daily-plan'

interface ActiveMasterBriefRef {
  id: string
  version: number | null
}

async function resolveActiveMasterBrief(clientId: string): Promise<ActiveMasterBriefRef | null> {
  const { data, error } = await supabaseAdmin
    .from('master_briefs')
    .select('id, version')
    .eq('client_id', clientId)
    .or('status.eq.active,is_active.eq.true')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  // A failed lookup must never read as "no active brief" (NEEDS_BRIEF) — that
  // would be a false success. Propagate so GET/POST return 500 instead.
  if (error) throw error
  return data ? { id: data.id, version: data.version ?? null } : null
}

function errorMessage(err: unknown): string {
  return err instanceof Error
    ? err.message
    : typeof err === 'object' && err !== null && 'message' in err
      ? String((err as { message: unknown }).message)
      : JSON.stringify(err)
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const clientId = params.id
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  const { searchParams } = new URL(req.url)
  const campaignId = searchParams.get('campaign_id')
  if (!campaignId) {
    return NextResponse.json({ success: false, error: 'campaign_id is required' }, { status: 400 })
  }

  try {
    const [campaign, masterBrief] = await Promise.all([
      getCampaignById(clientId, campaignId), // fail-closed: null on wrong-client campaign
      resolveActiveMasterBrief(clientId),
    ])

    if (!campaign) {
      const grounding = computeGrounding(campaign, masterBrief)
      return NextResponse.json({
        success: true,
        campaign: null,
        grounding,
        days: buildEmptyDays(todayIso()),
        bundles: [],
        publishing_plan: buildPublishingPlan(null),
        ad_candidate: null,
        plan_id: null,
      })
    }

    const { data: rows } = await supabaseAdmin
      .from('social_plans')
      .select('id, plan_data, created_at')
      .eq('client_id', clientId)
      .eq('campaign_id', campaignId)
      .contains('plan_data', { plan_kind: CAMPAIGN_DAILY_PLAN_KIND })
      .order('created_at', { ascending: false })
      .limit(1)

    const planRow = rows?.[0] ?? null
    const planData = (planRow?.plan_data ?? null) as CampaignDailyPlanData | null
    // Back-compat: rows written before the `bundles[]` migration only have a
    // singular `current_bundle`. Without this fallback the 7-day grid still
    // shows PLANNED slots but the only real content silently disappears.
    // TODO(#1159): remove once the data backfill to `bundles[]` has run.
    const legacyBundle = (planData as unknown as { current_bundle?: CampaignDailyPlanData['bundles'][number] | null })
      ?.current_bundle
    const bundles = planData?.bundles ?? (legacyBundle ? [legacyBundle] : [])
    const days = planData?.days ?? buildEmptyDays(todayIso())

    // Grounding must reflect what the SAVED plan was actually grounded in,
    // not "does an active brief happen to exist right now" — otherwise a plan
    // saved with no brief (or against an older brief) reads as freshly
    // grounded the moment someone later adds/changes the active Master Brief,
    // which is a false claim about content nobody re-validated.
    // Only when nothing has been saved yet do we fall back to the live brief,
    // to describe "would a save right now be grounded".
    const grounding = planData
      ? computeGrounding(campaign, planData.master_brief_ref)
      : computeGrounding(campaign, masterBrief)

    // Asset provenance — fail-closed: only assets that resolve under THIS
    // client's rows are surfaced; a cross-client id is silently excluded.
    // Resolved once across every day's bundle, not per-day, since the same
    // reference asset is often reused across multiple days.
    //
    // We now also resolve the Post `image_asset_id` here so GET returns the
    // authoritative preview URL/filename/source/ownership. The stored plan
    // never carries a caller-supplied preview URL — this is the only place
    // the review UI gets image data from.
    const reelAssetIds = bundles.flatMap(b => b.reel?.source_asset_ids ?? [])
    const postImageIds = bundles
      .map(b => (b as unknown as { post?: { image_asset_id?: string } }).post?.image_asset_id)
      .filter((x): x is string => typeof x === 'string' && x.length > 0)
    const referencedAssetIds = Array.from(new Set([...reelAssetIds, ...postImageIds]))
    let resolvedAssets: Array<{
      id: string
      storage_url: string
      original_filename: string | null
      source: string
      ownership: string
    }> = []
    if (referencedAssetIds.length > 0) {
      const { data: assets } = await supabaseAdmin
        .from('client_assets')
        .select('id, storage_url, original_filename, source, ownership')
        .eq('client_id', clientId)
        .in('id', referencedAssetIds)
      resolvedAssets = assets ?? []
    }
    const resolvedAssetIds = new Set(resolvedAssets.map(a => a.id))
    const assetById = new Map(resolvedAssets.map(a => [a.id, a]))

    // A day's bundle is included only when it actually exists in storage —
    // a PLANNED slot with no matching bundle entry is a data-shape bug, and
    // fails closed to an honest null rather than silently borrowing another
    // day's content.
    //
    // For each day's Post, attach a `post_image` block resolved from the
    // authoritative `client_assets` row, or null when the asset cannot be
    // resolved under this client (legacy row without image_asset_id, or a
    // stale id that no longer exists). Legacy rows produce null — GET
    // must never fabricate an image or CTA when the data is not proven.
    const bundlesWithReadiness = bundles.map(bundle => {
      const postField = (bundle as unknown as { post?: { image_asset_id?: string; cta_url?: string } | null }).post
      const imgId = postField?.image_asset_id
      const asset = imgId ? assetById.get(imgId) : undefined
      const postImage = asset
        ? {
            id: asset.id,
            preview_url: asset.storage_url,
            filename: asset.original_filename,
            source: asset.source,
            ownership: asset.ownership,
          }
        : null
      return {
        ...bundle,
        post_image: postImage,
        readiness: computeReadiness({ grounding, bundle, resolvedAssetIds }),
        provenance: (bundle.reel?.source_asset_ids ?? [])
          .map(id => assetById.get(id))
          .filter((a): a is NonNullable<typeof a> => !!a),
      }
    })

    // Ad candidate stays scoped to the earliest day that actually has a
    // Reel — WP1 previews at most one candidate, never one per day.
    const firstReelBundle = bundles.find(b => !!b.reel) ?? null

    return NextResponse.json({
      success: true,
      campaign: { id: campaign.id, title: campaign.title, offer: campaign.offer ?? null, primary_cta: campaign.primary_cta ?? null },
      grounding,
      days,
      bundles: bundlesWithReadiness,
      publishing_plan: buildPublishingPlan(campaign),
      ad_candidate: buildAdCandidate(firstReelBundle),
      plan_id: planRow?.id ?? null,
    })
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: errorMessage(err) }, { status: 500 })
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const clientId = params.id
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  const rawBody = await req.json().catch(() => null)
  const parsed = CampaignDailyCommandSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'INVALID_COMMAND', details: parsed.error.flatten() },
      { status: 400 }
    )
  }
  const cmd = parsed.data

  try {
    // Fail-closed: getCampaignById scopes by client_id, so a campaign_id
    // belonging to another client resolves to null here.
    const campaign = await getCampaignById(clientId, cmd.campaign_id)
    if (!campaign) {
      return NextResponse.json({ success: false, error: 'NEEDS_CAMPAIGN' }, { status: 404 })
    }

    const masterBrief = await resolveActiveMasterBrief(clientId)
    const grounding = computeGrounding(campaign, masterBrief)

    // CTA hard-binding — every Post's cta_url must EXACTLY equal the
    // campaign's persisted source URL. No arbitrary caller destination.
    // A campaign_briefs row with zero source_urls means the campaign is not
    // yet valid for a public CTA — fail closed rather than fall back.
    const campaignSourceUrl = (campaign.source_urls ?? [])[0] ?? null
    if (!campaignSourceUrl) {
      return NextResponse.json(
        { success: false, error: 'CAMPAIGN_HAS_NO_CTA_SOURCE_URL' },
        { status: 400 }
      )
    }
    const ctaMismatches = cmd.bundles
      .filter(b => b.post.cta_url !== campaignSourceUrl)
      .map(b => ({ date: b.date, provided: b.post.cta_url }))
    if (ctaMismatches.length > 0) {
      return NextResponse.json(
        { success: false, error: 'CTA_URL_MISMATCH', expected: campaignSourceUrl, mismatches: ctaMismatches },
        { status: 400 }
      )
    }

    // Every referenced asset (both Reel `source_asset_ids` and every Post's
    // `image_asset_id`) must belong to this client AND be a valid, usable,
    // non-archived image. Server re-resolves ownership + MIME + status from
    // the authoritative `client_assets` row — the caller does not supply
    // URL/ownership/preview, so a spoofed payload can never override real
    // asset data.
    const reelAssetIds = cmd.bundles.flatMap(b => b.reel?.source_asset_ids ?? [])
    const postImageIds = cmd.bundles.map(b => b.post.image_asset_id)
    const referencedAssetIds = Array.from(new Set([...reelAssetIds, ...postImageIds]))
    if (referencedAssetIds.length > 0) {
      const { data: assets } = await supabaseAdmin
        .from('client_assets')
        .select('id, mime_type, status, archived_at')
        .eq('client_id', clientId)
        .in('id', referencedAssetIds)
      const byId = new Map((assets ?? []).map(a => [a.id, a]))
      const foreignReel = reelAssetIds.filter(id => !byId.has(id))
      if (foreignReel.length > 0) {
        return NextResponse.json(
          { success: false, error: 'ASSET_NOT_OWNED_BY_CLIENT', foreign_asset_ids: foreignReel },
          { status: 403 }
        )
      }
      // Post image-specific gates: exists (client-scoped), analyzed status,
      // not archived, image MIME. Reject on any failure with the exact per-day
      // reason so a reviewer can act.
      const invalidPostImages = cmd.bundles.map(b => {
        const a = byId.get(b.post.image_asset_id)
        if (!a) return { date: b.date, id: b.post.image_asset_id, reason: 'not_owned_by_client' }
        if (a.archived_at) return { date: b.date, id: b.post.image_asset_id, reason: 'archived' }
        if (a.status !== 'analyzed') return { date: b.date, id: b.post.image_asset_id, reason: `status_${a.status}` }
        if (!(a.mime_type ?? '').startsWith('image/')) {
          return { date: b.date, id: b.post.image_asset_id, reason: 'not_an_image' }
        }
        return null
      }).filter((x): x is { date: string; id: string; reason: string } => x !== null)
      if (invalidPostImages.length > 0) {
        return NextResponse.json(
          { success: false, error: 'POST_IMAGE_INVALID', invalid: invalidPostImages },
          { status: 400 }
        )
      }
    }

    const { data: existing } = await supabaseAdmin
      .from('social_plans')
      .select('id')
      .eq('client_id', clientId)
      .eq('campaign_id', cmd.campaign_id)
      .contains('plan_data', { plan_kind: CAMPAIGN_DAILY_PLAN_KIND })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Complete-snapshot contract: the incoming command IS the new stored
    // seven-day plan; previously stored bundles are replaced wholesale, not
    // merged. Merging previously stored bundles into a new snapshot was
    // valid but reintroduced two risks the scope shrink is designed to
    // eliminate — preserved-old bundles carry the current save's
    // `master_brief_ref` (false grounding), and old dates outside the new
    // window leak into the render (stale window). Rejecting partial writes
    // and replacing wholesale removes both without adding per-bundle
    // grounding, migrations, or a merge/version framework.
    const planData: CampaignDailyPlanData = {
      plan_kind: CAMPAIGN_DAILY_PLAN_KIND,
      campaign_id: cmd.campaign_id,
      master_brief_ref: masterBrief,
      days: cmd.days,
      bundles: cmd.bundles,
      command_meta: {
        source: 'conversation_command',
        received_at: new Date().toISOString(),
        raw_summary: cmd.raw_summary ?? null,
      },
    }

    let planId: string
    if (existing?.id) {
      const { error } = await supabaseAdmin
        .from('social_plans')
        .update({ plan_data: planData })
        .eq('id', existing.id)
      if (error) throw error
      planId = existing.id
    } else {
      const { data: inserted, error } = await supabaseAdmin
        .from('social_plans')
        .insert({
          client_id: clientId,
          campaign_id: cmd.campaign_id,
          platform: 'facebook',
          wave_number: 1,
          plan_data: planData,
        })
        .select('id')
        .single()
      if (error) throw error
      planId = inserted.id
    }

    return NextResponse.json({ success: true, plan_id: planId, grounding, plan_data: planData })
  } catch (err: unknown) {
    return NextResponse.json({ success: false, error: errorMessage(err) }, { status: 500 })
  }
}
