import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBearerToken } from '@/lib/validation-utils'
import { getAnthropicClient, MODEL_SONNET } from '@/lib/anthropic/client'
import type { StrategyItem } from '@/lib/strategy/types'

/**
 * POST /api/clients/[id]/blog/[postId]/social-suggestions
 * Generates 3 social media content ideas (Facebook / Instagram / LinkedIn)
 * from an approved blog post and writes them to content_strategy_items.
 *
 * Security: requires Bearer INTERNAL_API_KEY.
 * Reference: ROADMAP.md P8.2.4
 */

export const maxDuration = 60

interface SuggestionRaw {
  platform: string
  proposed_title: string
  rationale: string
  content_angle: string
}

type Platform = 'facebook' | 'instagram' | 'linkedin'

function buildPrompt(title: string, keyword: string): string {
  return `You are a social media strategist for an AU/NZ marketing agency.
A blog post titled "${title}" (primary keyword: "${keyword}") has just been approved.
Generate 3 social media content ideas — one for Facebook, Instagram, and LinkedIn.
Facebook: community-focused, longer-form, NZ/AU audience.
Instagram: visual, punchy hook, concise caption idea.
LinkedIn: professional insight angle, B2B-friendly.
For each: proposed_title (max 80 chars), rationale (1-2 sentences), content_angle (1 sentence).
Use Australian/New Zealand English. Return JSON array only, no extra text.`
}

/**
 * Extract the outermost JSON array from a Claude response string.
 * Claude sometimes wraps the array in prose or markdown fences.
 */
function parseArrayResponse(text: string): SuggestionRaw[] {
  const trimmed = text.trim()
  const start = trimmed.indexOf('[')
  const end = trimmed.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`No JSON array found in response. Preview: ${trimmed.slice(0, 300)}`)
  }
  return JSON.parse(trimmed.slice(start, end + 1)) as SuggestionRaw[]
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; postId: string } }
) {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  try {
    const { id: clientId, postId } = params

    // Verify blog post exists and belongs to this client
    const { data: post, error: postError } = await supabaseAdmin
      .from('blog_posts')
      .select('id, title, primary_keyword, client_id')
      .eq('id', postId)
      .single()

    if (postError || !post) {
      if (postError) console.error('[social-suggestions POST] Supabase fetch error:', postError)
      return NextResponse.json({ success: false, error: 'Blog post not found' }, { status: 404 })
    }

    if (post.client_id !== clientId) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const title = (post.title as string) ?? 'Untitled'
    const keyword = (post.primary_keyword as string) ?? title

    // Call Anthropic — client initialised inside handler per CLAUDE.md
    const anthropic = getAnthropicClient()
    const message = await anthropic.messages.create({
      model: MODEL_SONNET,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: buildPrompt(title, keyword),
        },
      ],
    })

    const rawText = message.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('')

    let suggestions: SuggestionRaw[]
    try {
      suggestions = parseArrayResponse(rawText)
    } catch (parseErr) {
      console.error('[social-suggestions POST] JSON parse error:', parseErr, 'Raw:', rawText.slice(0, 500))
      return NextResponse.json(
        { success: false, error: 'Failed to parse AI response' },
        { status: 500 }
      )
    }

    // Validate we got exactly the 3 expected platforms (best-effort — use first 3)
    const strategyRunId = crypto.randomUUID()
    const rows = suggestions
      .filter((s): s is SuggestionRaw =>
        typeof s.platform === 'string' &&
        typeof s.proposed_title === 'string' &&
        typeof s.rationale === 'string' &&
        typeof s.content_angle === 'string'
      )
      .slice(0, 3)
      .map(s => {
        const platform = (s.platform.toLowerCase() as Platform)
        return {
          action_type: 'social_content' as const,
          content_mode: 'unified' as const,
          status: 'pending' as const,
          priority: 'medium' as const,
          priority_score: 50,
          linked_blog_post_id: postId,
          client_id: clientId,
          strategy_run_id: strategyRunId,
          proposed_title: s.proposed_title.slice(0, 80),
          rationale: `${platform.toUpperCase()}: ${s.rationale}`,
          content_angle: s.content_angle,
          source_page_id: null,
          source_query_id: null,
          source_keyword: null,
          keyword_volume: null,
          keyword_kd: null,
        }
      })

    if (rows.length === 0) {
      console.error('[social-suggestions POST] No valid suggestions parsed from AI response')
      return NextResponse.json(
        { success: false, error: 'AI returned no valid suggestions' },
        { status: 500 }
      )
    }

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('content_strategy_items')
      .insert(rows)
      .select('*')

    if (insertError) {
      console.error('[social-suggestions POST] Supabase insert error:', insertError)
      return NextResponse.json(
        { success: false, error: 'Failed to save strategy items' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, items: (inserted ?? []) as StrategyItem[] })
  } catch (err: unknown) {
    console.error('[social-suggestions POST] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}
