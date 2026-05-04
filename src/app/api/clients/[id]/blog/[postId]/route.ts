import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBearerToken } from '@/lib/validation-utils'
import type { BlogPost, BlogStatus } from '@/types/magic-engine'

/**
 * GET /api/clients/[id]/blog/[postId]
 * Full blog post detail (including html_body + geo_html_snapshot).
 *
 * PATCH /api/clients/[id]/blog/[postId]
 * Update mutable fields: status, featured_image_url, slug.
 * Body: { status?, featured_image_url?, slug? }
 *
 * DELETE /api/clients/[id]/blog/[postId]
 * Permanently remove a blog post.
 *
 * Security: All endpoints require a valid Bearer token (INTERNAL_API_KEY).
 * Error messages returned to callers are generic — DB schema details are
 * only written to server-side logs.
 *
 * Reference: ROADMAP.md P7.3.9–P7.3.10
 */

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; postId: string } }
) {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  try {
    const { id: clientId, postId } = params

    const { data, error } = await supabaseAdmin
      .from('blog_posts')
      .select('*')
      .eq('id', postId)
      .eq('client_id', clientId)   // ownership check
      .single<BlogPost>()

    if (error || !data) {
      // HIGH-3: log DB error details server-side, return generic 404 to caller
      if (error) console.error('[blog/:postId GET] Supabase error:', error)
      return NextResponse.json({ success: false, error: 'Post not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, post: data })
  } catch (err: unknown) {
    console.error('[blog/:postId GET] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; postId: string } }
) {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  try {
    const { id: clientId, postId } = params
    const body = (await req.json()) as {
      status?: BlogStatus
      featured_image_url?: string
      slug?: string
    }

    const VALID_STATUSES: BlogStatus[] = ['draft', 'approved', 'published', 'rejected']
    if (body.status && !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json(
        { success: false, error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` },
        { status: 400 }
      )
    }

    const patch: Record<string, unknown> = {}
    if (body.status !== undefined)             patch.status = body.status
    if (body.featured_image_url !== undefined) patch.featured_image_url = body.featured_image_url
    if (body.slug !== undefined)               patch.slug = body.slug?.slice(0, 120)
    if (body.status === 'published')           patch.published_at = new Date().toISOString()

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ success: false, error: 'No valid fields to update' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('blog_posts')
      .update(patch)
      .eq('id', postId)
      .eq('client_id', clientId)
      .select('*')
      .single<BlogPost>()

    if (error || !data) {
      // HIGH-3: log DB details server-side, return generic message to caller
      if (error) console.error('[blog/:postId PATCH] Supabase error:', error)
      return NextResponse.json(
        { success: false, error: 'Failed to update blog post' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, post: data })
  } catch (err: unknown) {
    console.error('[blog/:postId PATCH] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; postId: string } }
) {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  try {
    const { id: clientId, postId } = params

    const { error } = await supabaseAdmin
      .from('blog_posts')
      .delete()
      .eq('id', postId)
      .eq('client_id', clientId)

    if (error) {
      // HIGH-3: log DB details server-side, return generic message to caller
      console.error('[blog/:postId DELETE] Supabase error:', error)
      return NextResponse.json({ success: false, error: 'Failed to delete blog post' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    console.error('[blog/:postId DELETE] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}
