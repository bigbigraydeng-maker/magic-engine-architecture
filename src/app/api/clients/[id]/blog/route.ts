import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateBlogPost } from '@/lib/blog/generator'
import { auditExistingContent } from '@/lib/blog/content-auditor'
import type { BlogPost, GenerateBlogRequest } from '@/types/magic-engine'

/**
 * GET /api/clients/[id]/blog
 * List blog posts for a client, newest first.
 * Query: ?status=draft|approved|published|rejected  (omit for all)
 *        &limit=20
 *
 * POST /api/clients/[id]/blog
 * Generate a new blog post (stored as 'draft').
 * Body: GenerateBlogRequest
 *
 * Content Audit:
 *   Before generating, the handler fetches the client's domain and checks
 *   whether a post with the same intent already exists. If so, it returns
 *   { success: true, action: 'upgrade', audit } without generating a new post.
 *   The caller can pass skip_audit: true to bypass this check.
 *
 * Reference: ROADMAP.md P7.3.8
 */

interface ClientRow {
  id: string
  name: string
  domain: string | null
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const clientId = params.id
    const status = req.nextUrl.searchParams.get('status')
    const limit  = parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10)

    let query = supabaseAdmin
      .from('blog_posts')
      .select(
        'id, mode, topic, source_query_text, title, meta_title, slug, ' +
        'word_count, status, featured_image_url, cost_usd, created_at, updated_at'
      )
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (status) query = query.eq('status', status)

    const { data, error } = await query

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, posts: data ?? [] })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const clientId = params.id
    const body = (await req.json()) as GenerateBlogRequest

    if (!body.topic?.trim()) {
      return NextResponse.json(
        { success: false, error: 'topic is required' },
        { status: 400 }
      )
    }

    const validModes = ['unified', 'geo_only', 'seo_only']
    const mode = body.mode ?? 'geo_only'
    if (!validModes.includes(mode)) {
      return NextResponse.json(
        { success: false, error: `mode must be one of: ${validModes.join(', ')}` },
        { status: 400 }
      )
    }

    // ── Content Audit (pre-generation) ────────────────────────────────────────
    // Skip if caller explicitly opts out (e.g. user clicked "Generate Anyway")
    if (!body.skip_audit) {
      const { data: clientData } = await supabaseAdmin
        .from('clients')
        .select('id, name, domain')
        .eq('id', clientId)
        .single<ClientRow>()

      const domain = clientData?.domain

      if (domain) {
        const audit = await auditExistingContent(
          domain,
          body.topic,
          body.source_query_text
        ).catch(() => null) // audit failure must never block generation

        if (audit?.action === 'upgrade') {
          // Return early — UI should show upgrade recommendation card
          return NextResponse.json({
            success: true,
            action: 'upgrade',
            audit,
            post: null,
          })
        }

        // action === 'new' — proceed with generation, attach audit info to response
        const result = await generateBlogPost({ ...body, mode, client_id: clientId })
        return await persistAndReturn(clientId, body, mode, result, audit)
      }
    }

    // ── Generate (no domain set, or audit skipped) ────────────────────────────
    const result = await generateBlogPost({ ...body, mode, client_id: clientId })
    return await persistAndReturn(clientId, body, mode, result, null)

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function persistAndReturn(
  clientId: string,
  body: GenerateBlogRequest,
  mode: string,
  result: Awaited<ReturnType<typeof generateBlogPost>>,
  audit: Awaited<ReturnType<typeof auditExistingContent>> | null
) {
  const { data: post, error: dbErr } = await supabaseAdmin
    .from('blog_posts')
    .insert({
      client_id:          clientId,
      mode,
      topic:              body.topic.slice(0, 400),
      source_query_id:    body.source_query_id   ?? null,
      source_query_text:  body.source_query_text ?? null,
      title:              result.title,
      meta_title:         result.meta_title,
      meta_description:   result.meta_description,
      slug:               result.slug,
      html_body:          result.html_body,
      word_count:         result.word_count,
      geo_directive_id:   result.geo_directive_id,
      geo_html_snapshot:  result.geo_html_snapshot,
      featured_image_prompt: result.featured_image_prompt,
      cost_usd:           result.cost_usd,
      model_used:         result.model_used,
      status:             'draft',
    })
    .select('*')
    .single<BlogPost>()

  if (dbErr || !post) {
    return NextResponse.json(
      { success: false, error: dbErr?.message ?? 'Failed to save post' },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    action: 'new',
    post,
    audit,
    cost_usd: result.cost_usd,
  })
}
