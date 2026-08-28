/**
 * POST /api/clients/[id]/google-ads/keyword-ideas
 *
 * Wraps Google Ads Keyword Planner (`customers/{id}:generateKeywordIdeas`)
 * as a per-client endpoint. First-party Google data — the same numbers the
 * Google Ads UI shows — replacing DataForSEO in cases where its NZ / small-
 * market coverage falls short.
 *
 * Body (JSON):
 *   {
 *     keywords:       string[]           // 1–20 seeds; empty entries stripped
 *     geoTargetIds?:  number[]           // default [NZ = 2554]
 *     languageId?:    number             // default 1000 (English)
 *     network?:       'GOOGLE_SEARCH' | 'GOOGLE_SEARCH_AND_PARTNERS'
 *   }
 *
 * Responses:
 *   200 { ideas: KeywordIdea[] }
 *   400 body validation
 *   424 Google Ads credentials/customer_id not configured for this client
 *   502 Google Ads API error
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { loadGoogleAdsCredsForClient } from '@/lib/google-ads/creds-loader'
import { generateKeywordIdeas } from '@/lib/google-ads/keyword-planner'

interface RouteParams { params: { id: string } }

interface Body {
  keywords?:     unknown
  geoTargetIds?: unknown
  languageId?:   unknown
  network?:      unknown
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const clientId = params.id

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: Body
  try { body = await req.json() as Body }
  catch { return NextResponse.json({ error: 'body must be JSON' }, { status: 400 }) }

  if (!Array.isArray(body.keywords) || body.keywords.length === 0) {
    return NextResponse.json({ error: 'keywords must be a non-empty array of strings' }, { status: 400 })
  }
  const keywords = body.keywords
    .filter((k): k is string => typeof k === 'string')
    .map(k => k.trim())
    .filter(Boolean)
  if (keywords.length === 0) {
    return NextResponse.json({ error: 'keywords must contain at least one non-empty string' }, { status: 400 })
  }

  let geoTargetIds: number[] | undefined
  if (body.geoTargetIds !== undefined) {
    if (!Array.isArray(body.geoTargetIds) || !body.geoTargetIds.every(n => typeof n === 'number' && Number.isInteger(n) && n > 0)) {
      return NextResponse.json({ error: 'geoTargetIds must be an array of positive integers' }, { status: 400 })
    }
    geoTargetIds = body.geoTargetIds as number[]
  }

  let languageId: number | undefined
  if (body.languageId !== undefined) {
    if (typeof body.languageId !== 'number' || !Number.isInteger(body.languageId) || body.languageId <= 0) {
      return NextResponse.json({ error: 'languageId must be a positive integer' }, { status: 400 })
    }
    languageId = body.languageId
  }

  let network: 'GOOGLE_SEARCH' | 'GOOGLE_SEARCH_AND_PARTNERS' | undefined
  if (body.network !== undefined) {
    if (body.network !== 'GOOGLE_SEARCH' && body.network !== 'GOOGLE_SEARCH_AND_PARTNERS') {
      return NextResponse.json({ error: 'network must be GOOGLE_SEARCH or GOOGLE_SEARCH_AND_PARTNERS' }, { status: 400 })
    }
    network = body.network
  }

  const creds = await loadGoogleAdsCredsForClient(supabaseAdmin, clientId)
  if (!creds) {
    return NextResponse.json(
      {
        error:
          'Google Ads not configured for this client. ' +
          'Set clients.google_ads_customer_id, or complete the OAuth connection, ' +
          'and confirm GOOGLE_ADS_* env vars are present.',
      },
      { status: 424 },
    )
  }

  let ideas
  try {
    ideas = await generateKeywordIdeas(creds, { keywords, geoTargetIds, languageId, network })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[google-ads/keyword-ideas] error:', message)
    return NextResponse.json({ error: `Google Ads API error: ${message}` }, { status: 502 })
  }

  return NextResponse.json({ ideas })
}
