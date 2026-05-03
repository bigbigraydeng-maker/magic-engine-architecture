// Enrich Campaign Brief with SEMrush data + URL parsing
// Pulls question keywords + related keywords for the campaign topic
// Parses source URLs via Jina Reader

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getQuestionKeywords, getRelatedKeywords } from '@/lib/semrush/client'
import type { CampaignKeywordSnapshot } from '@/types/magic-engine'

type RouteContext = { params: { id: string; campaignId: string } }

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: clientId, campaignId } = params

  try {
    // 1. Load campaign
    const { data: campaign, error: loadErr } = await supabaseAdmin
      .from('campaign_briefs')
      .select('*')
      .eq('id', campaignId)
      .eq('client_id', clientId)
      .single()

    if (loadErr || !campaign) {
      return NextResponse.json({ success: false, error: 'Campaign not found' }, { status: 404 })
    }

    const body = await req.json().catch(() => ({}))
    const seedKeyword: string = body.seed_keyword ?? campaign.title
    const db: string = body.db ?? 'au'
    const warnings: string[] = []

    // 2. Parse source URLs with Jina (non-fatal)
    let parsed_content = campaign.parsed_content ?? ''
    const urlsToParse: string[] = (campaign.source_urls ?? []).filter(Boolean)

    if (urlsToParse.length > 0 && !parsed_content) {
      const texts: string[] = []
      for (const url of urlsToParse.slice(0, 3)) {
        try {
          const jinaRes = await fetch(`https://r.jina.ai/${url}`, {
            headers: { Accept: 'text/plain' },
            signal: AbortSignal.timeout(15000),
          })
          if (jinaRes.ok) {
            const text = await jinaRes.text()
            texts.push(text.slice(0, 2000))
          }
        } catch {
          warnings.push(`Failed to parse URL: ${url}`)
        }
      }
      if (texts.length > 0) {
        parsed_content = texts.join('\n\n---\n\n')
      }
    }

    // 3. SEMrush: question + related keywords (non-fatal)
    const semrush_keywords: CampaignKeywordSnapshot[] = []

    try {
      const [questions, related] = await Promise.allSettled([
        getQuestionKeywords(seedKeyword, db, 20),
        getRelatedKeywords(seedKeyword, db, 20),
      ])

      if (questions.status === 'fulfilled') {
        for (const k of questions.value) {
          semrush_keywords.push({ ...k, type: 'question' })
        }
      } else {
        warnings.push(`SEMrush questions: ${questions.reason}`)
      }

      if (related.status === 'fulfilled') {
        for (const k of related.value) {
          semrush_keywords.push({ ...k, type: 'related' })
        }
      } else {
        warnings.push(`SEMrush related: ${related.reason}`)
      }
    } catch (semErr) {
      warnings.push(`SEMrush enrichment skipped: ${String(semErr)}`)
    }

    // 4. Save enriched data back to campaign
    const { data: updated, error: saveErr } = await supabaseAdmin
      .from('campaign_briefs')
      .update({
        parsed_content:   parsed_content || campaign.parsed_content,
        semrush_keywords: semrush_keywords.length > 0 ? semrush_keywords : campaign.semrush_keywords,
        updated_at:       new Date().toISOString(),
      })
      .eq('id', campaignId)
      .select()
      .single()

    if (saveErr) throw saveErr

    return NextResponse.json({
      success: true,
      campaign: updated,
      keywords_found: semrush_keywords.length,
      urls_parsed: urlsToParse.length,
      warnings,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[campaign/enrich]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
