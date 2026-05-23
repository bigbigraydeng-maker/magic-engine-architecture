/**
 * Facebook Social Plan — Phase A
 * TypeScript interfaces, prompt builders, and content generators.
 *
 * generateChannelStrategy → Anthropic Claude Sonnet  (strategy reasoning)
 * generateReelsScripts / generatePosts / generateStories → OpenAI GPT-4o-mini
 *
 * All SDK clients are initialised inside functions — never at module top-level.
 */

import OpenAI from 'openai'
import { callClaudeWithDocs, parseJsonResponse } from '@/lib/anthropic/client'

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ChannelStrategy {
  platform: string
  theme: string
  content_pillars: string[]
  posting_frequency: string
  tone_guidance: string
  campaign_focus: string
  content_mix: {
    reels_pct: number
    posts_pct: number
    stories_pct: number
  }
}

/**
 * One Facebook Reel script — matches the ReelsStudio production format so
 * each card in the Social Plan is immediately actionable:
 *
 *   opening_frame_prompt  → paste into Visual Studio (opening frame)
 *   closing_frame_prompt  → paste into Visual Studio (closing / CTA frame)
 *   i2v_video_prompt      → paste into Video Studio (image-to-video)
 *   caption               → Facebook Reels caption with hashtags embedded
 *   hashtags              → standalone hashtag list
 */
export interface ReelsScript {
  title: string
  hook: string
  opening_frame_prompt: string
  closing_frame_prompt: string
  i2v_video_prompt: string
  caption: string
  hashtags: string[]
}

export type PostType = 'educational' | 'promotional' | 'storytelling' | 'engagement'

export interface Post {
  content_type: PostType
  copy: string
  image_prompt: string
  hashtags: string[]
}

export interface Story {
  copy: string
  cta: string
  visual_prompt: string
}

export interface SocialPlanOutput {
  strategy: ChannelStrategy
  reels: ReelsScript[]
  posts: Post[]
  stories: Story[]
}

// ─── JSON parse helpers ────────────────────────────────────────────────────────

/**
 * Parse JSON from an OpenAI response — strips code fences, finds the first
 * complete [ ] or { } block, then JSON.parses it.
 */
function parseOpenAIJson<T>(raw: string): T {
  const stripped = raw
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim()

  const bracket = stripped.indexOf('[')
  const brace = stripped.indexOf('{')

  let start: number
  let endChar: string

  if (bracket === -1 && brace === -1) {
    throw new Error(`No JSON found in OpenAI response: ${raw.slice(0, 200)}`)
  } else if (bracket === -1) {
    start = brace; endChar = '}'
  } else if (brace === -1) {
    start = bracket; endChar = ']'
  } else {
    if (bracket < brace) { start = bracket; endChar = ']' }
    else { start = brace; endChar = '}' }
  }

  const end = stripped.lastIndexOf(endChar)
  if (end <= start) {
    throw new Error(`Malformed JSON in OpenAI response: ${raw.slice(0, 200)}`)
  }

  return JSON.parse(stripped.slice(start, end + 1)) as T
}

// ─── System prompts ────────────────────────────────────────────────────────────

const SYSTEM_STRATEGY = `You are a senior social media strategist specialising in AU/NZ markets.
Analyse the brand brief and produce a Facebook channel strategy as a single JSON object.
Return ONLY raw JSON — no markdown, no code fences, no explanation.`

const SYSTEM_REELS = `You are a Facebook Reels content strategist for AU/NZ brands.
Produce 3 Reels scripts as a JSON array.

Each object must have exactly these keys:
  title: string — descriptive concept title
  hook: string — opening hook shown in first 3 seconds (≤15 words)
  opening_frame_prompt: string — detailed AI image-generation prompt for the opening frame (9:16 vertical, cinematic, NO human faces, vivid environment)
  closing_frame_prompt: string — detailed AI image-generation prompt for the closing/CTA frame (9:16 vertical, brand colours prominent, NO human faces)
  i2v_video_prompt: string — image-to-video prompt in this exact format: "Opening: <motion description> | Middle: <visual journey, transitions, mood> | Closing: <final moments and CTA>"
  caption: string — Facebook Reels caption (AU/NZ English, 2–3 short paragraphs, clear CTA, 5–8 hashtags embedded)
  hashtags: string[] — standalone array of 5–8 hashtags matching caption

Rules: all English, no human faces in image prompts, no Chinese text.
Return ONLY a raw JSON array — no markdown, no code fences.`

const SYSTEM_POSTS = `You are a Facebook copywriter for AU/NZ brands.
Produce 5 Facebook posts as a JSON array. Each post object must have:
  content_type: "educational"|"promotional"|"storytelling"|"engagement"
  copy: Facebook post copy (AU/NZ English, 80–300 words, include a clear CTA)
  image_prompt: detailed AI image-generation prompt (9:16 vertical, no human faces, vivid, cinematic)
  hashtags: array of 5–8 relevant hashtags
Return ONLY a raw JSON array — no markdown, no code fences.`

const SYSTEM_STORIES = `You are a Facebook Stories copywriter for AU/NZ brands.
Produce 3 Stories as a JSON array. Each story object must have:
  copy: short punchy overlay text (≤30 words, AU/NZ English)
  cta: swipe-up or tap call-to-action text (≤10 words)
  visual_prompt: AI image-generation prompt (9:16 portrait, no human faces, vivid)
Return ONLY a raw JSON array — no markdown, no code fences.`

// ─── Prompt builders ───────────────────────────────────────────────────────────

export function buildChannelStrategyPrompt(briefText: string, campaignText?: string): string {
  const campaign = campaignText ? `\n\n## Campaign Context\n${campaignText}` : ''
  return `## Brand Brief\n${briefText}${campaign}

Produce a Facebook channel strategy JSON object with exactly these keys:
{
  "platform": "facebook",
  "theme": "<one-sentence content theme for this period>",
  "content_pillars": ["<pillar 1>", "<pillar 2>", "<pillar 3>"],
  "posting_frequency": "<e.g. 5 posts/week + 3 stories + 2 reels>",
  "tone_guidance": "<2–3 sentences on voice and tone for this brand on Facebook>",
  "campaign_focus": "<what this period's content should emphasise>",
  "content_mix": {
    "reels_pct": <number 0-100>,
    "posts_pct": <number 0-100>,
    "stories_pct": <number 0-100>
  }
}`
}

export function buildReelsPrompt(
  strategy: ChannelStrategy,
  briefText: string,
  campaignText?: string,
  viralInsightsText?: string,
): string {
  const campaign = campaignText ? `\n\n## Campaign Context\n${campaignText}` : ''
  const viral = viralInsightsText ? `\n\n${viralInsightsText}` : ''
  return `## Brand Brief\n${briefText}${campaign}${viral}

## Channel Strategy
Theme: ${strategy.theme}
Content Pillars: ${strategy.content_pillars.join(', ')}
Campaign Focus: ${strategy.campaign_focus}
Tone: ${strategy.tone_guidance}

Produce 3 Reels scripts as a JSON array. Each script must have:
  title, hook, opening_frame_prompt, closing_frame_prompt, i2v_video_prompt, caption (≤2200 chars), hashtags (string[])

Image prompts must be 9:16 vertical, cinematic, no human faces.
i2v_video_prompt format: "Opening: <motion> | Middle: <journey + transitions> | Closing: <CTA moment>"`
}

export function buildPostPrompt(
  strategy: ChannelStrategy,
  briefText: string,
  campaignText?: string,
): string {
  const campaign = campaignText ? `\n\n## Campaign Context\n${campaignText}` : ''
  return `## Brand Brief\n${briefText}${campaign}

## Channel Strategy
Theme: ${strategy.theme}
Content Pillars: ${strategy.content_pillars.join(', ')}
Campaign Focus: ${strategy.campaign_focus}
Tone: ${strategy.tone_guidance}

Produce 5 Facebook posts covering a variety of content types (educational, promotional, storytelling, engagement).
Each post must have copy (AU/NZ English, 80–300 words, with a clear CTA), image_prompt (9:16 vertical, no faces), and 5–8 hashtags.

Return a JSON array of 5 Post objects.`
}

export function buildStoryPrompt(
  strategy: ChannelStrategy,
  briefText: string,
  campaignText?: string,
): string {
  const campaign = campaignText ? `\n\n## Campaign Context\n${campaignText}` : ''
  return `## Brand Brief\n${briefText}${campaign}

## Channel Strategy
Theme: ${strategy.theme}
Campaign Focus: ${strategy.campaign_focus}
Tone: ${strategy.tone_guidance}

Produce 3 Facebook Stories. Each must have copy (≤30 words, AU/NZ English), cta (≤10 words), and visual_prompt (9:16 portrait, no faces).

Return a JSON array of 3 Story objects.`
}

// ─── Content generators ────────────────────────────────────────────────────────

export async function generateChannelStrategy(
  briefText: string,
  campaignText?: string,
): Promise<ChannelStrategy> {
  const result = await callClaudeWithDocs({
    systemPrompt: SYSTEM_STRATEGY,
    userMessage: buildChannelStrategyPrompt(briefText, campaignText),
    maxOutputTokens: 1024,
  })
  return parseJsonResponse<ChannelStrategy>(result.text)
}

export async function generateReelsScripts(
  strategy: ChannelStrategy,
  briefText: string,
  campaignText?: string,
  viralInsightsText?: string,
): Promise<ReelsScript[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is not set')
  const openai = new OpenAI({ apiKey })

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.8,
    max_tokens: 3000,
    messages: [
      { role: 'system', content: SYSTEM_REELS },
      { role: 'user', content: buildReelsPrompt(strategy, briefText, campaignText, viralInsightsText) },
    ],
  })

  const raw = resp.choices[0].message.content ?? '[]'
  return parseOpenAIJson<ReelsScript[]>(raw)
}

export async function generatePosts(
  strategy: ChannelStrategy,
  briefText: string,
  campaignText?: string,
): Promise<Post[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is not set')
  const openai = new OpenAI({ apiKey })

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.8,
    max_tokens: 3500,
    messages: [
      { role: 'system', content: SYSTEM_POSTS },
      { role: 'user', content: buildPostPrompt(strategy, briefText, campaignText) },
    ],
  })

  const raw = resp.choices[0].message.content ?? '[]'
  return parseOpenAIJson<Post[]>(raw)
}

export async function generateStories(
  strategy: ChannelStrategy,
  briefText: string,
  campaignText?: string,
): Promise<Story[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is not set')
  const openai = new OpenAI({ apiKey })

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.8,
    max_tokens: 1500,
    messages: [
      { role: 'system', content: SYSTEM_STORIES },
      { role: 'user', content: buildStoryPrompt(strategy, briefText, campaignText) },
    ],
  })

  const raw = resp.choices[0].message.content ?? '[]'
  return parseOpenAIJson<Story[]>(raw)
}

