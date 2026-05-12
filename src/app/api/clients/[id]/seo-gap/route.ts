/**
 * POST /api/clients/[id]/seo-gap
 *   multipart/form-data: files[] (1–10 SEMrush keyword gap CSVs)
 *   Optional form field: title (string)
 *   Runs full analysis pipeline: parse → score → Claude → DOCX
 *   Returns: { success, analysis_id, summary, docx_base64 }
 *
 * GET /api/clients/[id]/seo-gap
 *   Returns list of previous analyses for this client.
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBearerToken } from '@/lib/validation-utils'
import { parseKeywordGapCsvs } from '@/lib/seo-gap/csv-parser'
import { analyzeSeoGap } from '@/lib/seo-gap/analyzer'
import { generateSeoGapDocx } from '@/lib/seo-gap/docx-generator'

const MAX_FILES = 10
const MAX_FILE_SIZE_MB = 5

interface ClientRow {
  id: string
  name: string
  domain: string | null
}

// ─── GET: List analyses ───────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('seo_analyses')
      .select('id, title, csv_count, competitor_count, total_keywords, b2c_keywords, cost_usd, status, report_url, created_at')
      .eq('client_id', params.id)
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) {
      console.error('[seo-gap GET]', error)
      return NextResponse.json({ success: false, error: 'Failed to list analyses' }, { status: 500 })
    }

    return NextResponse.json({ success: true, analyses: data ?? [] })
  } catch (err) {
    console.error('[seo-gap GET] unexpected', err)
    return NextResponse.json({ success: false, error: 'Unexpected error' }, { status: 500 })
  }
}

// ─── POST: Run analysis pipeline ─────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  const clientId = params.id
  let analysisId: string | null = null

  try {
    // ── 1. Load client ────────────────────────────────────────────────────────
    const { data: client } = await supabaseAdmin
      .from('clients')
      .select('id, name, domain')
      .eq('id', clientId)
      .single<ClientRow>()

    if (!client) {
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 })
    }

    // ── 2. Parse multipart files ──────────────────────────────────────────────
    const formData = await req.formData()
    const rawFiles = formData.getAll('files') as File[]
    const title = (formData.get('title') as string | null) ?? 'SEO Gap Analysis'

    if (rawFiles.length === 0) {
      return NextResponse.json({ success: false, error: 'No files provided' }, { status: 400 })
    }

    if (rawFiles.length > MAX_FILES) {
      return NextResponse.json(
        { success: false, error: `Maximum ${MAX_FILES} files allowed` },
        { status: 400 }
      )
    }

    const buffers: Buffer[] = []
    for (const file of rawFiles) {
      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        return NextResponse.json(
          { success: false, error: `File ${file.name} exceeds ${MAX_FILE_SIZE_MB}MB limit` },
          { status: 400 }
        )
      }
      buffers.push(Buffer.from(await file.arrayBuffer()))
    }

    // ── 3. Create pending DB record ───────────────────────────────────────────
    const { data: record, error: insertErr } = await supabaseAdmin
      .from('seo_analyses')
      .insert({
        client_id: clientId,
        title,
        csv_count: rawFiles.length,
        status: 'processing',
      })
      .select('id')
      .single()

    if (insertErr || !record) {
      console.error('[seo-gap POST] insert error', insertErr)
      return NextResponse.json({ success: false, error: 'Failed to create analysis record' }, { status: 500 })
    }

    analysisId = record.id

    // ── 4. Parse CSVs ─────────────────────────────────────────────────────────
    const parseResult = parseKeywordGapCsvs(buffers, client.domain ?? undefined)

    if (parseResult.keywords.length === 0) {
      await failAnalysis(analysisId!, 'No keywords found in CSV files. Check delimiter format.')
      return NextResponse.json({ success: false, error: 'No keywords parsed from CSVs' }, { status: 422 })
    }

    // ── 5. AI analysis ────────────────────────────────────────────────────────
    const analysis = await analyzeSeoGap({
      rawKeywords: parseResult.keywords,
      competitors: parseResult.competitors,
      clientDomain: client.domain ?? 'unknown.com.au',
      clientName: client.name,
    })

    // ── 6. Generate DOCX ──────────────────────────────────────────────────────
    const reportDate = new Date().toLocaleDateString('en-AU', {
      day: 'numeric', month: 'long', year: 'numeric',
    })
    const docxBuffer = await generateSeoGapDocx(analysis, client.name, reportDate)
    const docxBase64 = docxBuffer.toString('base64')

    // ── 7. Upload DOCX to Supabase Storage ────────────────────────────────────
    const filename = `${clientId}/seo-gap-${analysisId}.docx`
    const bucket = 'reports'

    // Ensure bucket exists (ignore "already exists" errors)
    await supabaseAdmin.storage.createBucket(bucket, { public: false }).catch(() => {})

    await supabaseAdmin.storage.from(bucket).upload(filename, docxBuffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      upsert: true,
    })

    const { data: signedData } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUrl(filename, 60 * 60 * 24 * 7) // 7 days

    const reportUrl = signedData?.signedUrl ?? null

    // ── 8. Update DB record ───────────────────────────────────────────────────
    await supabaseAdmin.from('seo_analyses').update({
      status: 'completed',
      competitor_count: analysis.competitors.length,
      total_keywords: analysis.total_keywords_raw,
      b2c_keywords: analysis.total_keywords_b2c,
      analysis_json: analysis as unknown as Record<string, unknown>,
      report_url: reportUrl,
      cost_usd: analysis.cost_usd,
    }).eq('id', analysisId)

    // ── 9. Return response ────────────────────────────────────────────────────
    return NextResponse.json({
      success: true,
      analysis_id: analysisId,
      report_url: reportUrl,
      docx_base64: docxBase64,
      summary: {
        total_keywords_raw:  analysis.total_keywords_raw,
        total_keywords_b2c:  analysis.total_keywords_b2c,
        competitors:         analysis.competitors.length,
        tier_a_count:        analysis.tier_a.length,
        tier_b_count:        analysis.tier_b.length,
        tier_c_count:        analysis.tier_c.length,
        clusters:            analysis.clusters.map(c => ({ name: c.name, volume: c.total_volume })),
        executive_summary:   analysis.ai_insights.executive_summary,
        cost_usd:            analysis.cost_usd,
      },
    })
  } catch (err: unknown) {
    console.error('[seo-gap POST] pipeline error', err)
    if (analysisId) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      await failAnalysis(analysisId, message)
    }
    return NextResponse.json({ success: false, error: 'Analysis pipeline failed' }, { status: 500 })
  }
}

async function failAnalysis(id: string, message: string) {
  await supabaseAdmin
    .from('seo_analyses')
    .update({ status: 'failed', error_message: message.slice(0, 500) })
    .eq('id', id)
}
