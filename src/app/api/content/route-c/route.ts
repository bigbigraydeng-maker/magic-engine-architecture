import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getActiveBrief, formatBriefForPrompt } from '@/lib/content/brief-injector'
import { getCampaignById, formatCampaignForPrompt } from '@/lib/content/campaign-injector'
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function POST(req: NextRequest) {
  try {
    const { client_id, topic, platforms, campaign_id } = await req.json()

    if (!client_id || !topic) {
      return NextResponse.json(
        { success: false, error: 'client_id and topic are required' },
        { status: 400 }
      )
    }

    const targetPlatforms: string[] = platforms || ['facebook', 'tiktok']

    // 1. Get Master Brief
    const brief = await getActiveBrief(client_id)
    if (!brief) {
      return NextResponse.json(
        { success: false, error: 'No active Master Brief for this client.' },
        { status: 400 }
      )
    }

    const briefText = formatBriefForPrompt(brief)

    // 1b. Load Campaign Brief if provided
    const campaign = campaign_id ? await getCampaignById(client_id, campaign_id) : null
    const campaignText = campaign ? formatCampaignForPrompt(campaign) : ''

    // 2. Generate V1 and V2 in parallel
    const generateVariant = async (variant: 1 | 2) => {
      const variantNote = variant === 1
        ? 'Variant 1: Use the most direct and compelling angle.'
        : 'Variant 2: Use an alternative angle — different emotion or target persona.'

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.8,
        messages: [
          {
            role: 'system',
            content: `You are a social media content strategist. Create engaging content that fits the brand DNA exactly.
${briefText}
${campaignText ? `\n${campaignText}` : ''}

Output ONLY valid JSON with these fields:
{
  "title": "...",
  "script": "...",
  "caption": "...",
  "hashtags": ["...", "..."],
  "visual_brief": "..."
}`,
          },
          {
            role: 'user',
            content: `Create a social media post about: "${topic}"
Platforms: ${targetPlatforms.join(', ')}
${variantNote}

The script should be 100-200 words. Caption should be 50-100 words. Include 8-12 relevant hashtags.
Visual brief should describe the ideal image/video for this post in 30-50 words.`,
          },
        ],
      })

      const raw = completion.choices[0].message.content ?? '{}'
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      const parsed = JSON.parse(cleaned)

      return {
        title: `${parsed.title || topic} [V${variant}]`,
        script: parsed.script || '',
        caption: parsed.caption || '',
        hashtags: parsed.hashtags || [],
        visual_brief: parsed.visual_brief || '',
      }
    }

    const [v1, v2] = await Promise.all([generateVariant(1), generateVariant(2)])

    // 3. Save to Supabase
    const postBase = {
      client_id,
      route: 'route_c' as const,
      platforms: targetPlatforms,
      source_brief_id: brief.id,
      campaign_id: campaign?.id ?? null,
      content_mode: campaign ? 'campaign' : 'brand',
      status: 'draft' as const,
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[route-c] SUPABASE_SERVICE_ROLE_KEY not set — using anon client, insert will be silently blocked by RLS')
    }

    const { data: savedPosts, error } = await supabaseAdmin
      .from('content_posts')
      .insert([
        { ...postBase, ...v1 },
        { ...postBase, ...v2 },
      ])
      .select()

    if (error) {
      console.error('[route-c] DB insert error:', JSON.stringify(error))
      throw error
    }
    if (!savedPosts?.length) {
      console.error('[route-c] DB insert returned no rows — RLS may be blocking (anon key fallback?)')
      throw new Error('Content generated but failed to save — check Render logs for DB error')
    }

    return NextResponse.json({
      success: true,
      variants: savedPosts ?? [v1, v2],
      posts: savedPosts,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[route-c]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
