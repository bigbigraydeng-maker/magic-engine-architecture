import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getActiveBrief, formatBriefForPrompt } from '@/lib/content/brief-injector'
import { getCampaignById, formatCampaignForPrompt } from '@/lib/content/campaign-injector'
import { createRecord, updateRecord } from '@/lib/airtable/client'
import { POST_TO_AIRTABLE } from '@/lib/airtable/field-maps'
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function POST(req: NextRequest) {
  try {
    const { client_id, keyword, platforms, campaign_id } = await req.json()

    if (!client_id || !keyword) {
      return NextResponse.json(
        { success: false, error: 'client_id and keyword are required' },
        { status: 400 }
      )
    }

    // Normalize platforms: accept string or string[]
    const targetPlatforms: string[] = Array.isArray(platforms)
      ? platforms
      : typeof platforms === 'string'
        ? [platforms]
        : ['facebook', 'tiktok']

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

    // 2. Find keyword record if it exists (to get SEO context + ID)
    const { data: kwRecord } = await supabaseAdmin
      .from('keywords')
      .select('id, keyword, volume, intent, opportunity_score')
      .eq('client_id', client_id)
      .eq('keyword', keyword)
      .single()

    const seoContext = kwRecord
      ? `SEO Data: Monthly Volume ${kwRecord.volume ?? 'N/A'}, Intent: ${kwRecord.intent ?? 'N/A'}, Opportunity Score: ${kwRecord.opportunity_score ?? 'N/A'}`
      : ''

    // 3. Generate V1 and V2 in parallel
    const generateVariant = async (variant: 1 | 2) => {
      const variantNote = variant === 1
        ? 'Variant 1: Educational angle — explain the value and benefits clearly.'
        : 'Variant 2: Inspirational angle — use storytelling or emotion to connect.'

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.8,
        messages: [
          {
            role: 'system',
            content: `You are a social media content strategist specializing in SEO-driven content. Create engaging posts that rank for keywords while fitting the brand DNA.
${briefText}
${campaignText ? `\n${campaignText}` : ''}
${seoContext}

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
            content: `Create a social media post targeting the keyword: "${keyword}"
Platforms: ${targetPlatforms.join(', ')}
${variantNote}

The script should be 100-200 words. Caption 50-100 words. 8-12 hashtags including the keyword.
Visual brief: 30-50 words describing the ideal visual.`,
          },
        ],
      })

      const raw = completion.choices[0].message.content ?? '{}'
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      const parsed = JSON.parse(cleaned)

      return {
        title: `${parsed.title || keyword} [V${variant}]`,
        script: parsed.script || '',
        caption: parsed.caption || '',
        hashtags: parsed.hashtags || [],
        visual_brief: parsed.visual_brief || '',
      }
    }

    const [v1, v2] = await Promise.all([generateVariant(1), generateVariant(2)])

    // 4. Save to Supabase
    const postBase = {
      client_id,
      route: 'route_a' as const,
      platforms: targetPlatforms,
      source_brief_id: brief.id,
      source_keyword_id: kwRecord?.id ?? null,
      campaign_id: campaign?.id ?? null,
      content_mode: campaign ? 'campaign' : 'brand',
      status: 'draft' as const,
    }

    // Diagnose supabaseAdmin key usage
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[route-a] SUPABASE_SERVICE_ROLE_KEY not set — using anon client, insert will be silently blocked by RLS')
    }

    const { data: savedPosts, error } = await supabaseAdmin
      .from('content_posts')
      .insert([
        { ...postBase, ...v1 },
        { ...postBase, ...v2 },
      ])
      .select()

    if (error) {
      console.error('[route-a] DB insert error:', JSON.stringify(error))
      throw error
    }
    if (!savedPosts?.length) {
      console.error('[route-a] DB insert returned no rows — RLS may be blocking (anon key fallback?)')
      throw new Error('Content generated but failed to save — check Render logs for DB error')
    }

    // 5. Sync to Airtable Content Calendar (non-fatal)
    if (savedPosts?.length) {
      try {
        const { data: client } = await supabaseAdmin
          .from('clients')
          .select('airtable_base_id')
          .eq('id', client_id)
          .single()

        if (client?.airtable_base_id) {
          const baseId = client.airtable_base_id
          for (const post of savedPosts) {
            try {
              const atRecord = await createRecord(
                baseId,
                'Content Calendar',
                POST_TO_AIRTABLE(post)
              )
              await supabaseAdmin
                .from('content_posts')
                .update({ airtable_record_id: atRecord.id })
                .eq('id', post.id)
            } catch (perRecordErr) {
              console.error(`[route-a] Airtable sync failed for post ${post.id}:`, perRecordErr)
            }
          }
        }
      } catch (atErr) {
        console.error('[route-a] Airtable sync step failed:', atErr)
      }
    }

    return NextResponse.json({
      success: true,
      keyword,
      posts: savedPosts?.map(p => p.id) ?? [],
      variants: savedPosts ?? [v1, v2],
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[route-a]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
