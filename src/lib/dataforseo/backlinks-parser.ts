/**
 * Parse DataForSEO backlinks response and store in Supabase
 */

import { supabaseAdmin } from '@/lib/supabase'

interface BacklinkItem {
  url: string
  domain: string
  title?: string
  anchor: string
  tld_rank?: number
  citation_flow?: number
  trust_flow?: number
  last_seen?: string
  first_seen?: string
  type: 'do-follow' | 'no-follow' | 'internal'
  page_rank?: number
  image_alt?: string
  status_code?: number
}

interface BacklinkSummaryData {
  backlinks?: number
  referring_domains?: number
  referring_pages?: number
  rank?: number
}

export async function storeBacklinkData(
  clientId: string,
  targetDomain: string,
  backlinks: BacklinkItem[],
  summaryData?: BacklinkSummaryData
): Promise<void> {
  // Get today's date for comparison (to mark new/lost)
  const today = new Date().toISOString().split('T')[0]

  // Fetch existing backlinks from last sync to detect new/lost
  const { data: previousBacklinks } = await supabaseAdmin
    .from('backlink_data')
    .select('referring_url')
    .eq('client_id', clientId)
    .eq('target_domain', targetDomain)
    .order('created_at', { ascending: false })
    .limit(10000) // Reasonable limit

  const previousUrls = new Set(previousBacklinks?.map((b) => b.referring_url) || [])
  const currentUrls = new Set(backlinks.map((b) => b.url))

  // Find new and lost backlinks
  const newBacklinks = backlinks.filter((b) => !previousUrls.has(b.url))
  const lostBacklinks = Array.from(previousUrls).filter((url) => !currentUrls.has(url))

  // Prepare upsert data
  const backlinkRecords = backlinks.map((backlink) => ({
    client_id: clientId,
    target_domain: targetDomain,
    referring_domain: backlink.domain,
    referring_url: backlink.url,
    anchor_text: backlink.anchor || null,
    tld_rank: backlink.tld_rank || null,
    citation_flow: backlink.citation_flow || null,
    trust_flow: backlink.trust_flow || null,
    last_seen_date: backlink.last_seen || today,
    link_type: backlink.type,
    page_rank: backlink.page_rank || null,
    image_alt: backlink.image_alt || null,
    status_code: backlink.status_code || null,
    first_seen_date: backlink.first_seen || today,
    is_new: newBacklinks.some((b) => b.url === backlink.url),
    is_lost: false, // Current backlinks are not lost
  }))

  // Mark lost backlinks
  if (lostBacklinks.length > 0) {
    await supabaseAdmin
      .from('backlink_data')
      .update({ is_lost: true })
      .eq('client_id', clientId)
      .eq('target_domain', targetDomain)
      .in('referring_url', lostBacklinks)
  }

  // Upsert current backlinks
  if (backlinkRecords.length > 0) {
    const { error } = await supabaseAdmin
      .from('backlink_data')
      .upsert(backlinkRecords, {
        onConflict: 'client_id,target_domain,referring_url',
        ignoreDuplicates: false, // Update if exists
      })

    if (error) {
      throw new Error(`Failed to store backlink data: ${error.message}`)
    }
  }

  // Store velocity snapshot
  if (summaryData) {
    const velocityRecord = {
      client_id: clientId,
      target_domain: targetDomain,
      snapshot_date: today,
      total_backlinks: summaryData.backlinks || 0,
      new_backlinks: newBacklinks.length,
      lost_backlinks: lostBacklinks.length,
      referring_domains_count: summaryData.referring_domains || 0,
      avg_domain_rank: backlinks.length > 0
        ? Math.round(
            backlinks.reduce((sum, b) => sum + (b.tld_rank || 0), 0) / backlinks.length
          )
        : null,
    }

    const { error: velocityError } = await supabaseAdmin
      .from('backlink_velocity')
      .upsert(velocityRecord, {
        onConflict: 'client_id,target_domain,snapshot_date',
        ignoreDuplicates: false,
      })

    if (velocityError) {
      console.error('Failed to store backlink velocity:', velocityError)
      // Don't throw - velocity is secondary to actual backlink data
    }
  }
}

/**
 * Calculate backlink metrics for reporting
 */
export async function getBacklinkMetrics(clientId: string, domain: string) {
  const today = new Date().toISOString().split('T')[0]

  // Get today's snapshot
  const { data: todaySnapshot } = await supabaseAdmin
    .from('backlink_velocity')
    .select('*')
    .eq('client_id', clientId)
    .eq('target_domain', domain)
    .eq('snapshot_date', today)
    .single()

  // Get last 4 weeks
  const fourWeeksAgo = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0]

  const { data: weeklySnapshots } = await supabaseAdmin
    .from('backlink_velocity')
    .select('*')
    .eq('client_id', clientId)
    .eq('target_domain', domain)
    .gte('snapshot_date', fourWeeksAgo)
    .order('snapshot_date', { ascending: true })

  // Get quality distribution
  const { data: qualityDistribution } = await supabaseAdmin
    .from('backlink_data')
    .select('tld_rank', { count: 'exact' })
    .eq('client_id', clientId)
    .eq('target_domain', domain)
    .eq('is_lost', false)

  return {
    today: todaySnapshot,
    weekly: weeklySnapshots,
    quality: qualityDistribution || [],
  }
}
