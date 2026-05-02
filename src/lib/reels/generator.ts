/**
 * Reels Studio — prompt generator
 *
 * Uses Claude (Strategy Engine) to produce four pieces of content from a
 * Master Brief + optional Campaign Brief:
 *
 *   1. opening_frame_prompt  — AI image-gen prompt for the opening frame
 *   2. closing_frame_prompt  — AI image-gen prompt for the closing frame
 *   3. i2v_video_prompt      — Image-to-Video prompt (Opening / Middle / Closing sections)
 *   4. fb_caption            — Facebook Reels caption with hashtags
 *
 * Reference: ROADMAP.md P8.R.3
 */

import {
  callClaudeWithDocs,
  callClaudeChat,
  parseJsonResponse,
  MODEL_SONNET,
} from '@/lib/anthropic/client'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReelsContent {
  opening_frame_prompt: string
  closing_frame_prompt: string
  i2v_video_prompt: string
  fb_caption: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

// ─── System prompts ───────────────────────────────────────────────────────────

const SYSTEM_GENERATE = `You are a Reels content strategist for AU/NZ markets.
Given a brand brief and optional campaign context, generate four pieces of content for a Facebook Reels.
Respond with ONLY a valid JSON object — no markdown, no explanation.`

const SYSTEM_REFINE = `You are a Reels content strategist helping refine specific fields.
The user will ask to change one or more fields. Return ONLY the updated JSON object with ALL four fields
(even unchanged ones). No markdown, no explanation.`

// ─── Initial generation ───────────────────────────────────────────────────────

/**
 * Generate the four Reels content pieces from briefs.
 *
 * @param masterBriefText   Serialised master brief (plain text or JSON string)
 * @param campaignContext   Optional campaign brief context (plain text)
 * @param brandName         Client brand name, injected into system prompt
 */
export async function generateReelsContent(params: {
  masterBriefText: string
  campaignContext?: string
  brandName: string
}): Promise<ReelsContent> {
  const { masterBriefText, campaignContext, brandName } = params

  const campaignSection = campaignContext
    ? `\n\n## Campaign Brief\n${campaignContext}`
    : ''

  const userMessage = `## Master Brief for ${brandName}\n${masterBriefText}${campaignSection}

Generate four pieces of Reels content in this exact JSON format:
{
  "opening_frame_prompt": "<detailed AI image generation prompt for the opening frame — vivid, cinematic, platform-optimised for 9:16>",
  "closing_frame_prompt": "<detailed AI image generation prompt for the closing/CTA frame>",
  "i2v_video_prompt": "Opening: <describe motion in opening frame> | Middle: <describe the visual journey, transitions, mood> | Closing: <describe final moments and CTA>",
  "fb_caption": "<compelling Facebook Reels caption in AU/NZ English, 2-3 short paragraphs, 5-8 relevant hashtags>"
}`

  const result = await callClaudeWithDocs({
    systemPrompt: SYSTEM_GENERATE,
    userMessage,
    maxOutputTokens: 2048,
  })

  return parseJsonResponse<ReelsContent>(result.text)
}

// ─── Chat refinement ──────────────────────────────────────────────────────────

/**
 * Apply a user's chat instruction to refine one or more fields.
 * Returns the full updated ReelsContent (all four fields).
 *
 * @param current      Current state of the four fields
 * @param history      Prior conversation turns (excluding the new user message)
 * @param userMessage  The new user instruction (e.g. "Change opening frame to Great Wall sunrise")
 */
export async function refineReelsContent(params: {
  current: ReelsContent
  history: ChatMessage[]
  userMessage: string
}): Promise<{ updated: ReelsContent; assistantReply: string }> {
  const { current, history, userMessage } = params

  // Build message thread: inject current state as system context, then prior turns
  const contextBlock = `Current Reels content:
${JSON.stringify(current, null, 2)}`

  const messages: ChatMessage[] = [
    // Synthetic assistant turn so Claude has current state in context
    { role: 'assistant', content: contextBlock },
    ...history,
    { role: 'user', content: userMessage },
  ]

  const result = await callClaudeChat({
    systemPrompt: SYSTEM_REFINE,
    messages,
    maxOutputTokens: 2048,
  })

  const updated = parseJsonResponse<ReelsContent>(result.text)

  // Build a human-readable summary of what changed
  const changed = (Object.keys(updated) as Array<keyof ReelsContent>).filter(
    k => updated[k] !== current[k]
  )

  const assistantReply =
    changed.length === 0
      ? 'No changes detected — the content looks the same.'
      : `Updated ${changed.join(', ')}.`

  return { updated, assistantReply }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Serialise a master_brief row to a readable text block for prompt injection.
 */
export function formatMasterBriefForPrompt(brief: Record<string, unknown>): string {
  const lines: string[] = []

  if (brief.brand_name)      lines.push(`Brand: ${brief.brand_name}`)
  if (brief.tagline)         lines.push(`Tagline: ${brief.tagline}`)
  if (brief.primary_audience) lines.push(`Audience: ${brief.primary_audience}`)
  if (brief.tone)            lines.push(`Tone: ${brief.tone}`)
  if (brief.visual_style)    lines.push(`Visual Style: ${brief.visual_style}`)

  if (Array.isArray(brief.pain_points) && brief.pain_points.length > 0) {
    lines.push(`Pain Points: ${(brief.pain_points as string[]).join('; ')}`)
  }

  if (brief.products && typeof brief.products === 'object') {
    try {
      const products = Array.isArray(brief.products)
        ? brief.products
        : [brief.products]
      const productSummary = products
        .map((p: Record<string, unknown>) => p.name ?? p.description ?? JSON.stringify(p))
        .join(', ')
      lines.push(`Products/Services: ${productSummary}`)
    } catch {
      // Skip products if they can't be serialised
    }
  }

  if (Array.isArray(brief.content_topics) && brief.content_topics.length > 0) {
    lines.push(`Content Topics: ${(brief.content_topics as string[]).join(', ')}`)
  }

  if (Array.isArray(brief.avoid_words) && brief.avoid_words.length > 0) {
    lines.push(`Avoid: ${(brief.avoid_words as string[]).join(', ')}`)
  }

  return lines.join('\n')
}

export { MODEL_SONNET }
