import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import type { SocialPlanOutput } from '@/lib/social/social-plan-templates'

function postRoute(contentType: string): string {
  if (contentType === 'promotional') return 'route_a'
  if (contentType === 'storytelling') return 'route_b'
  return 'route_c'
}

// POST /api/clients/[id]/social-plan/[planId]/save-to-board
// Reads plan_data from social_plans, inserts posts[] + stories[] into content_posts as drafts.
// Simple insert — no dedup, caller may call multiple times; UI shows saved count.
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; planId: string } }
) {
  const { id: clientId, planId } = params

  try {
    const { data: planRow, error: planErr } = await supabaseAdmin
      .from('social_plans')
      .select('id, campaign_id, plan_data')
      .eq('id', planId)
      .eq('client_id', clientId)
      .single()

    if (planErr || !planRow) {
      return NextResponse.json({ success: false, error: 'Plan not found' }, { status: 404 })
    }

    const planData = planRow.plan_data as SocialPlanOutput
    const posts = planData.posts ?? []
    const stories = planData.stories ?? []

    const postRows = posts.map((post) => ({
      client_id:         clientId,
      campaign_brief_id: planRow.campaign_id ?? null,
      title:             `${post.content_type} — ${post.copy.slice(0, 30)}`,
      route:             postRoute(post.content_type),
      platforms:         ['facebook'],
      status:            'draft',
      caption:           post.copy,
      hashtags:          post.hashtags,
      visual_brief:      post.image_prompt,
    }))

    const storyRows = stories.map((story, i) => ({
      client_id:         clientId,
      campaign_brief_id: planRow.campaign_id ?? null,
      title:             `Story ${i + 1} — ${story.copy.slice(0, 25)}`,
      route:             'story',
      platforms:         ['facebook'],
      status:            'draft',
      caption:           `${story.copy}\n\n→ ${story.cta}`,
      visual_brief:      story.visual_prompt,
    }))

    let savedPosts = 0
    let savedStories = 0

    if (postRows.length > 0) {
      const { error } = await supabaseAdmin.from('content_posts').insert(postRows)
      if (error) throw error
      savedPosts = postRows.length
    }

    if (storyRows.length > 0) {
      const { error } = await supabaseAdmin.from('content_posts').insert(storyRows)
      if (error) throw error
      savedStories = storyRows.length
    }

    return NextResponse.json({ success: true, saved_posts: savedPosts, saved_stories: savedStories })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[save-to-board]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
