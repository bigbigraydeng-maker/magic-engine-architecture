import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateBlogPost } from '@/lib/blog/generator'
import type { BlogPost, BlogStatus } from '@/types/magic-engine'

/**
 * GET /api/clients/[id]/blog/[postId]
 * Full blog post detail (including html_body + geo_html_snapshot).
 *
 * PATCH /api/clients/[id]/blog/[postId]
 * Update mutable fields: status, featured_image_url, slug.
 * Body: { status?, featured_image_url?, slug? }
 *
 * POST /api/clients/[id]/blog/[postId]/regenerate  → see separate route
 *
 * Reference: ROADMAP.md P7.3.9–P7.3.10
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; postId: string } }
) {
  try {
    const { id: clientId, postId } = params

    const { data, error } = await supabaseAdmin
      .from('blog_posts')
      .select('*')
      .eq('id', postId)
      .eq('client_id', clientId)   // ownership check
      .single<BlogPost>()

    if (error || !data) {
      return NextResponse.json({ success: false, error: 'Post not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, post: data })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; postId: string } }
) {
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
      return NextResponse.json(
        { success: false, error: error?.message ?? 'Update failed' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, post: data })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; postId: string } }
) {
  try {
    const { id: clientId, postId } = params

    const { error } = await supabaseAdmin
      .from('blog_posts')
      .delete()
      .eq('id', postId)
      .eq('client_id', clientId)

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
