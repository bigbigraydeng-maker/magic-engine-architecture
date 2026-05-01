import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateBlogPost } from '@/lib/blog/generator'
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
 * Reference: ROADMAP.md P7.3.8
 */

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

    // Validate mode
    const validModes = ['unified', 'geo_only', 'seo_only']
    const mode = body.mode ?? 'geo_only'
    if (!validModes.includes(mode)) {
      return NextResponse.json(
        { success: false, error: `mode must be one of: ${validModes.join(', ')}` },
        { status: 400 }
      )
    }

    // Generate via GPT-4o
    const result = await generateBlogPost({ ...body, mode, client_id: clientId })

    // Persist as draft
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
      post,
      cost_usd: result.cost_usd,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
