// Batch content generation for a Campaign Brief
// Generates N posts using Route A (keyword) and/or Route C (free topic)
// All posts land in 'draft' status for human review before entering calendar

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getActiveBrief, formatBriefForPrompt } from '@/lib/content/brief-injector'
import { getCampaignById, formatCampaignForPrompt } from '@/lib/content/campaign-injector'
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

interface BatchGenerateRequest {
  platforms: string[]          // ['facebook', 'tiktok']
  direction_note: string       // campaign angle / tagline
  route_a_count: number        // keyword-based posts
  route_c_count: number        // free-topic posts
}

type RouteType = 'route_a' | 'route_c'

interface PostDraft {
  title: string
  script: string
  caption: string
  hashtags: string[]
  visual_brief: string
  route: RouteType
  input_used: string
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; campaignId: string } }
) {
  const { id: clientId, campaignId } = params

  try {
    const body: BatchGenerateRequest = await req.json()
    const { platforms, direction_note, route_a_count, route_c_count } = body

    if (!platforms?.length) {
      return NextResponse.json({ success: false, error: 'platforms required' }, { status: 400 })
    }

    const totalPosts = (route_a_count ?? 0) + (route_c_count ?? 0)
    if (totalPosts < 1 || totalPosts > 30) {
      return NextResponse.json({ success: false, error: 'Total posts must be 1–30' }, { status: 400 })
    }

    // 1. Load Master Brief
    const brief = await getActiveBrief(clientId)
    if (!brief) {
      return NextResponse.json(
        { success: false, error: 'No active Master Brief for this client.' },
        { status: 400 }
      )
    }
    const briefText = formatBriefForPrompt(brief)

    // 2. Load Campaign Brief
    const campaign = await getCampaignById(clientId, campaignId)
    if (!campaign) {
      return NextResponse.json({ success: false, error: 'Campaign not found' }, { status: 404 })
    }
    const campaignText = formatCampaignForPrompt(campaign)

    // 3. Build keyword list for Route A
    const campaignKeywords = (campaign.semrush_keywords ?? [])
      .map((k: { keyword: string }) => k.keyword)
      .slice(0, route_a_count)

    // If not enough SEMrush keywords, supplement with direction_note segments
    const keywordsToUse: string[] = [...campaignKeywords]
    if (keywordsToUse.length < route_a_count) {
      // Ask Claude to generate additional keyword angles
      const needed = route_a_count - keywordsToUse.length
      try {
        const supplementRes = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          temperature: 0.7,
          messages: [{
            role: 'user',
            content: `Generate ${needed} distinct SEO keyword phrases (2-5 words each) for this campaign: "${direction_note || campaign.title}"\nOutput JSON array only: ["keyword1","keyword2",...]`,
          }],
        })
        const raw = supplementRes.choices[0].message.content ?? '[]'
        const extra = JSON.parse(raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()) as string[]
        keywordsToUse.push(...extra.slice(0, needed))
      } catch {
        // Non-fatal: fill with campaign title variations
        for (let i = keywordsToUse.length; i < route_a_count; i++) {
          keywordsToUse.push(`${campaign.title} ${i + 1}`)
        }
      }
    }

    // 4. Build topic list for Route C
    let topicsToUse: string[] = []
    if (route_c_count > 0) {
      try {
        const topicRes = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          temperature: 0.9,
          messages: [{
            role: 'user',
            content: `Generate ${route_c_count} distinct social media content topic angles for this campaign: "${direction_note || campaign.title}"\nEach topic should have a different emotional hook or audience angle.\nOutput JSON array only: ["topic1","topic2",...]`,
          }],
        })
        const raw = topicRes.choices[0].message.content ?? '[]'
        topicsToUse = JSON.parse(raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()) as string[]
      } catch {
        topicsToUse = Array.from({ length: route_c_count }, (_, i) => `${direction_note || campaign.title} - angle ${i + 1}`)
      }
    }

    // 5. Generate all posts (in controlled batches of 5 concurrent)
    const systemPrompt = `You are a social media content strategist. Create engaging content that fits the brand DNA exactly.
${briefText}

${campaignText}

Output ONLY valid JSON:
{
  "title": "...",
  "script": "...",
  "caption": "...",
  "hashtags": ["..."],
  "visual_brief": "..."
}`

    const generatePost = async (route: RouteType, inputText: string, variantHint: string): Promise<PostDraft> => {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.85,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: route === 'route_a'
              ? `Create a social media post targeting keyword: "${inputText}"\nPlatforms: ${platforms.join(', ')}\n${variantHint}\nScript: 100-200 words. Caption: 50-100 words. 8-12 hashtags including keyword.`
              : `Create a social media post about: "${inputText}"\nPlatforms: ${platforms.join(', ')}\n${variantHint}\nScript: 100-200 words. Caption: 50-100 words. 8-12 relevant hashtags.`,
          },
        ],
      })

      const raw = completion.choices[0].message.content ?? '{}'
      const parsed = JSON.parse(raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())

      return {
        title: parsed.title || inputText,
        script: parsed.script || '',
        caption: parsed.caption || '',
        hashtags: parsed.hashtags || [],
        visual_brief: parsed.visual_brief || '',
        route,
        input_used: inputText,
      }
    }

    // Build task list
    const tasks: Array<{ route: RouteType; input: string; hint: string }> = [
      ...keywordsToUse.slice(0, route_a_count).map((kw, i) => ({
        route: 'route_a' as RouteType,
        input: kw,
        hint: i % 2 === 0 ? 'Educational angle — explain value and benefits.' : 'Inspirational angle — use storytelling.',
      })),
      ...topicsToUse.slice(0, route_c_count).map((t, i) => ({
        route: 'route_c' as RouteType,
        input: t,
        hint: i % 2 === 0 ? 'Use a direct, compelling angle.' : 'Use an alternative emotional angle.',
      })),
    ]

    // Process in batches of 5 to avoid rate limits
    const BATCH_SIZE = 5
    const drafts: PostDraft[] = []

    for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
      const batch = tasks.slice(i, i + BATCH_SIZE)
      const results = await Promise.allSettled(
        batch.map(t => generatePost(t.route, t.input, t.hint))
      )
      for (const result of results) {
        if (result.status === 'fulfilled') drafts.push(result.value)
      }
    }

    if (drafts.length === 0) {
      throw new Error('All generation attempts failed')
    }

    // 6. Bulk insert to Supabase
    const rows = drafts.map(d => ({
      client_id:       clientId,
      route:           d.route,
      platforms,
      title:           d.title,
      script:          d.script,
      caption:         d.caption,
      hashtags:        d.hashtags,
      visual_brief:    d.visual_brief,
      source_brief_id: brief.id,
      campaign_id:     campaign.id,
      content_mode:    'campaign',
      status:          'draft',
    }))

    const { data: savedPosts, error } = await supabaseAdmin
      .from('content_posts')
      .insert(rows)
      .select('id, title, route, status')

    if (error) throw error

    return NextResponse.json({
      success: true,
      generated: drafts.length,
      saved: savedPosts?.length ?? 0,
      failed: drafts.length - (savedPosts?.length ?? 0),
      posts: savedPosts,
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[campaign/batch-generate]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
