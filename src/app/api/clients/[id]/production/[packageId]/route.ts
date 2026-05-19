import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

type RouteContext = { params: { id: string; packageId: string } }

// GET /api/clients/[id]/production/[packageId]
// Returns the production package with linked items and content previews.
export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { id: clientId, packageId } = params

  // 1. Fetch the package (scoped to client for safety)
  const { data: pkg, error: pkgError } = await supabaseAdmin
    .from('production_packages')
    .select(
      'id, client_id, master_brief_id, dimension, campaign_id, diagnostic_run_id, ' +
      'diagnostic_finding_id, prescription_id, execution_item_id, ' +
      'source_payload, generation_context_snapshot, title, brief, status, created_at, updated_at'
    )
    .eq('id', packageId)
    .eq('client_id', clientId)
    .single()

  if (pkgError || !pkg) {
    return NextResponse.json({ success: false, error: 'Production package not found' }, { status: 404 })
  }

  // 2. Parallel: campaign + execution_item lookups (only if FK present)
  const [campaignResult, executionItemResult] = await Promise.all([
    pkg.campaign_id
      ? supabaseAdmin
          .from('campaign_briefs')
          .select('id, name, theme, dimension')
          .eq('id', pkg.campaign_id)
          .single()
      : Promise.resolve({ data: null, error: null }),
    pkg.execution_item_id
      ? supabaseAdmin
          .from('execution_items')
          .select('id, title, dimension, status, fix_type, phase')
          .eq('id', pkg.execution_item_id)
          .single()
      : Promise.resolve({ data: null, error: null }),
  ])

  // 3. Fetch production_items for this package
  const { data: items, error: itemsError } = await supabaseAdmin
    .from('production_items')
    .select('id, content_type, content_post_id, blog_post_id, reel_id, visual_asset_id, sort_order, status, created_at')
    .eq('package_id', packageId)
    .order('sort_order', { ascending: true })

  if (itemsError) {
    return NextResponse.json({ success: false, error: 'Failed to fetch production items' }, { status: 500 })
  }

  const safeItems = items ?? []

  // 4. Batch-fetch linked content by type
  const postIds     = safeItems.filter(i => i.content_type === 'content_post').map(i => i.content_post_id as string)
  const blogIds     = safeItems.filter(i => i.content_type === 'blog_post').map(i => i.blog_post_id as string)
  const reelIds     = safeItems.filter(i => i.content_type === 'reel').map(i => i.reel_id as string)
  const visualIds   = safeItems.filter(i => i.content_type === 'visual_asset').map(i => i.visual_asset_id as string)

  const [postsResult, blogsResult, reelsResult, visualsResult, adsSnapshotsResult, reputationReviewsResult] = await Promise.all([
    postIds.length
      ? supabaseAdmin
          .from('content_posts')
          .select('id, title, caption, status, platforms, scheduled_at, visual_brief')
          .in('id', postIds)
      : Promise.resolve({ data: [], error: null }),
    blogIds.length
      ? supabaseAdmin
          .from('blog_posts')
          .select('id, title, slug, status, featured_image_url, word_count')
          .in('id', blogIds)
      : Promise.resolve({ data: [], error: null }),
    reelIds.length
      ? supabaseAdmin
          .from('reels_drafts')
          .select('id, title, status')
          .in('id', reelIds)
      : Promise.resolve({ data: [], error: null }),
    visualIds.length
      ? supabaseAdmin
          .from('visual_assets')
          .select('id, title, status, image_url')
          .in('id', visualIds)
      : Promise.resolve({ data: [], error: null }),
    // P13.D: ads snapshots linked to this package (dimension='ads')
    supabaseAdmin
      .from('meta_ads_snapshots')
      .select('id, period_start, period_end, spend, impressions, clicks, conversions, roas, cpc, ctr, fetched_at')
      .eq('production_package_id', packageId)
      .order('fetched_at', { ascending: false }),
    // P13.D: reputation reviews linked to this package (dimension='reputation')
    supabaseAdmin
      .from('project_reviews')
      .select('id, status, summary, created_at')
      .eq('production_package_id', packageId)
      .order('created_at', { ascending: false }),
  ])

  // 5. Build lookup maps for O(1) merge
  const postMap    = Object.fromEntries((postsResult.data   ?? []).map(r => [r.id, r]))
  const blogMap    = Object.fromEntries((blogsResult.data   ?? []).map(r => [r.id, r]))
  const reelMap    = Object.fromEntries((reelsResult.data   ?? []).map(r => [r.id, r]))
  const visualMap  = Object.fromEntries((visualsResult.data ?? []).map(r => [r.id, r]))

  const enrichedItems = safeItems.map(item => ({
    ...item,
    content: (() => {
      switch (item.content_type) {
        case 'content_post':  return postMap[item.content_post_id ?? '']   ?? null
        case 'blog_post':     return blogMap[item.blog_post_id ?? '']      ?? null
        case 'reel':          return reelMap[item.reel_id ?? '']           ?? null
        case 'visual_asset':  return visualMap[item.visual_asset_id ?? ''] ?? null
        default:              return null
      }
    })(),
  }))

  return NextResponse.json({
    success: true,
    package: pkg,
    campaign:            campaignResult.data      ?? null,
    execution_item:      executionItemResult.data ?? null,
    items:               enrichedItems,
    ads_snapshots:       adsSnapshotsResult.data  ?? [],
    reputation_reviews:  reputationReviewsResult.data ?? [],
  })
}
