/**
 * GET  /api/clients/[id]/campaign-daily-plan?campaign_id=<uuid>
 *
 * Read-only projection: Master Brief/Campaign grounding, the seven-day
 * Post/Story/Reel slot grid, today's current review bundle, source asset
 * provenance and factual readiness gates. Publishing/ad status is always
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
  type CampaignDailyBundle,
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
      const emptyBundle: CampaignDailyBundle | null = null
      const grounding = computeGrounding(campaign, masterBrief)
      return NextResponse.json({
        success: true,
        campaign: null,
        grounding,
        days: buildEmptyDays(todayIso()),
        current_bundle: emptyBundle,
        provenance: [],
        readiness: computeReadiness({ grounding, bundle: emptyBundle, resolvedAssetIds: new Set() }),
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
    const bundle = planData?.current_bundle ?? null
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
    const referencedAssetIds = bundle?.reel?.source_asset_ids ?? []
    let provenance: Array<{
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
      provenance = assets ?? []
    }
    const resolvedAssetIds = new Set(provenance.map(a => a.id))

    const readiness = computeReadiness({ grounding, bundle, resolvedAssetIds })

    return NextResponse.json({
      success: true,
      campaign: { id: campaign.id, title: campaign.title, offer: campaign.offer ?? null, primary_cta: campaign.primary_cta ?? null },
      grounding,
      days,
      current_bundle: bundle,
      provenance,
      readiness,
      publishing_plan: buildPublishingPlan(campaign),
      ad_candidate: buildAdCandidate(bundle),
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

    // Fail-closed: every referenced source asset must belong to this client.
    const referencedAssetIds = cmd.current_bundle.reel?.source_asset_ids ?? []
    if (referencedAssetIds.length > 0) {
      const { data: owned } = await supabaseAdmin
        .from('client_assets')
        .select('id')
        .eq('client_id', clientId)
        .in('id', referencedAssetIds)
      const ownedIds = new Set((owned ?? []).map(a => a.id))
      const foreign = referencedAssetIds.filter(id => !ownedIds.has(id))
      if (foreign.length > 0) {
        return NextResponse.json(
          { success: false, error: 'ASSET_NOT_OWNED_BY_CLIENT', foreign_asset_ids: foreign },
          { status: 403 }
        )
      }
    }

    const planData: CampaignDailyPlanData = {
      plan_kind: CAMPAIGN_DAILY_PLAN_KIND,
      campaign_id: cmd.campaign_id,
      master_brief_ref: masterBrief,
      days: cmd.days,
      current_bundle: cmd.current_bundle,
      command_meta: {
        source: 'conversation_command',
        received_at: new Date().toISOString(),
        raw_summary: cmd.raw_summary ?? null,
      },
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
