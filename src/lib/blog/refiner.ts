/**
 * Blog post refiner — FDE-directed, conversational editing.
 *
 * The FDE talks directly to the client and brings back knowledge that the
 * Master Brief and Campaign cannot capture ("the customer wants to lead with
 * small-group tours"). This applies a natural-language instruction to an
 * existing article while keeping it on-brand and on-campaign.
 *
 * Mirrors the Reels refinement pattern (src/lib/reels/generator.ts).
 */

import { callClaudeChat, parseJsonResponse } from '../anthropic/client'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BlogRefineContent {
  title: string
  meta_title: string
  meta_description: string
  html_body: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_REFINE = `You are an expert SEO/GEO blog editor for AU/NZ markets.
The user is an FDE who talks directly to the client. They will ask you to change
parts of an existing article. Apply ONLY what they ask, keep everything else
intact, and stay consistent with the brand brief and the active campaign.

CRITICAL OUTPUT RULES:
- Respond with ONLY a single flat JSON object — no markdown, no code fences, no explanation.
- Keys exactly: title, meta_title, meta_description, html_body. Return ALL keys even if unchanged.
- meta_title ≤ 60 chars; meta_description ≤ 155 chars.
- html_body must stay valid HTML (<h1>/<h2>/<p>/<ul>/<ol>/<section class="faq"> …) in AU/NZ English.`

// ─── Refinement ───────────────────────────────────────────────────────────────

/**
 * Apply an FDE chat instruction to an existing article.
 * Returns the full updated content (all four fields) plus a short reply.
 *
 * @param current      Current article fields
 * @param briefText    Serialised Master Brief (brand DNA — always injected)
 * @param campaignText Optional active campaign context
 * @param history      Prior conversation turns (excluding the new message)
 * @param userMessage  The new FDE instruction
 */
export async function refineBlogPost(params: {
  current: BlogRefineContent
  briefText: string
  campaignText?: string
  history: ChatMessage[]
  userMessage: string
}): Promise<{ updated: BlogRefineContent; assistantReply: string }> {
  const { current, briefText, campaignText, history, userMessage } = params

  const campaignSection = campaignText
    ? `\n\n## Active Campaign\n${campaignText}`
    : ''

  const contextBlock = `## Brand Brief (must stay consistent)\n${briefText}${campaignSection}

## Current article (JSON)
${JSON.stringify(current, null, 2)}`

  const messages: ChatMessage[] = [
    // Synthetic assistant turn so Claude has the current state + briefs in context
    { role: 'assistant', content: contextBlock },
    ...history,
    { role: 'user', content: userMessage },
  ]

  const result = await callClaudeChat({
    systemPrompt: SYSTEM_REFINE,
    messages,
    maxOutputTokens: 8192,
  })

  const parsed = parseJsonResponse<Partial<BlogRefineContent>>(result.text)

  // Normalise — fall back to the current value for any field Claude omits.
  const updated: BlogRefineContent = {
    title:            (parsed.title ?? current.title).slice(0, 200),
    meta_title:       (parsed.meta_title ?? current.meta_title).slice(0, 60),
    meta_description: (parsed.meta_description ?? current.meta_description).slice(0, 155),
    html_body:        parsed.html_body ?? current.html_body,
  }

  const changed = (Object.keys(updated) as Array<keyof BlogRefineContent>)
    .filter(k => updated[k] !== current[k])

  const FIELD_LABELS: Record<keyof BlogRefineContent, string> = {
    title:            '标题',
    meta_title:       'Meta 标题',
    meta_description: 'Meta 描述',
    html_body:        '正文',
  }

  const assistantReply = changed.length === 0
    ? '没有检测到改动 —— 文章保持原样。可以换个说法再试。'
    : `已更新：${changed.map(k => FIELD_LABELS[k]).join('、')}。`

  return { updated, assistantReply }
}
