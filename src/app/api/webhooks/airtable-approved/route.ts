import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// Zapier 发来的 payload：
// { table, supabase_id, new_status, revision_notes?, zapier_secret }

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { table, supabase_id, new_status, revision_notes, zapier_secret } = body

    if (zapier_secret !== process.env.ZAPIER_WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!supabase_id || !new_status) {
      return NextResponse.json({ error: 'supabase_id and new_status required' }, { status: 400 })
    }

    const validStatuses = ['approved', 'rejected', 'reviewed']
    if (!validStatuses.includes(new_status)) {
      return NextResponse.json({ error: `Invalid status: ${new_status}` }, { status: 400 })
    }

    // ── Keywords ────────────────────────────────────
    if (table === 'keywords') {
      const { error } = await supabaseAdmin
        .from('keywords')
        .update({
          status: new_status,
          status_updated_at: new Date().toISOString(),
          status_updated_by: 'airtable',
        })
        .eq('id', supabase_id)

      if (error) throw error
      return NextResponse.json({ success: true, table: 'keywords', status: new_status })
    }

    // ── Content Posts ────────────────────────────────
    if (table === 'content_posts' || table === 'content') {
      const updateData: Record<string, unknown> = { status: new_status }
      if (revision_notes) updateData.revision_notes = revision_notes

      const { error } = await supabaseAdmin
        .from('content_posts')
        .update(updateData)
        .eq('id', supabase_id)

      if (error) throw error

      // approved → 后台自动触发，不等待（避免 Zapier 超时）
      if (new_status === 'approved') {
        triggerApprovedWorkflow(supabase_id).catch(err =>
          console.error('[webhook] approved workflow error:', err)
        )
      }

      return NextResponse.json({ success: true, table: 'content', status: new_status })
    }

    return NextResponse.json({ error: 'Unknown table' }, { status: 400 })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[webhook/airtable-approved]', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

async function triggerApprovedWorkflow(postId: string): Promise<void> {
  const { data: post } = await supabaseAdmin
    .from('content_posts')
    .select('id, client_id, visual_brief')
    .eq('id', postId)
    .single()

  if (!post) return

  const { data: existingAssets } = await supabaseAdmin
    .from('visual_assets')
    .select('id, generation_status')
    .eq('post_id', postId)

  const readyAsset = existingAssets?.find(a => a.generation_status === 'ready')

  // 如果没有素材，先生成图片
  if (!readyAsset && post.visual_brief) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL
    await fetch(`${appUrl}/api/visual/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ post_id: postId, client_id: post.client_id, variant: 1 }),
    })
    // 图片生成是异步的，cron poll-visual-jobs 会在完成后推 Publer
    return
  }

  // 已有素材，直接推 Publer
  if (readyAsset) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL
    await fetch(`${appUrl}/api/publer/create-post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ post_id: postId, client_id: post.client_id }),
    })
  }
}
