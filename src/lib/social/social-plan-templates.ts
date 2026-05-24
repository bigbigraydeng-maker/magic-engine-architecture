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

/** Content angle — drives visual style and messaging for each Reel. */
export type AngleTag =
  | 'price_attack'
  | 'speed_attack'
  | 'trust_attack'
  | 'pet_floor'
  | 'scarcity'
  | 'seasonal'

/**
 * One Facebook Reel script — 9-panel storyboard format.
 *
 * Production flow:
 *   1. FDE copies storyboard_image_prompt → ChatGPT Image → generates 9-panel storyboard image
 *   2. FDE uploads storyboard image + copies seedance_i2v_prompt → Seedance 2.0 → 15-second Reel video
 *
 * scene_structure: exactly 9 strings (Panels 1–8 + Brand Panel)
 * storyboard_image_prompt: complete standalone ChatGPT Image prompt (200–400 words)
 * seedance_i2v_prompt: complete Seedance I2V prompt (200–350 words, 8 sections)
 */
export interface ReelsScript {
  title: string
  hook_line: string
  scene_structure: string[]
  storyboard_image_prompt: string
  seedance_i2v_prompt: string
  caption: string
  hashtags: string[]
  angle_tag: AngleTag
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

const SYSTEM_REELS = `You are a senior Facebook Reels director and storyboard artist for AU/NZ brands.
Produce 3 Reels scripts as a JSON array. Each targets a 15-second Facebook Reel.

Each JSON object MUST have ALL of these keys (no omissions):

1. title: string — short descriptive concept title (max 8 words)

2. hook_line: string — opening hook for first 1.5 seconds (max 15 words).
   MUST start with a number OR create immediate curiosity/surprise.
   Examples: "7 signs your lawn needs help now", "Most homeowners never know this trick…"

3. scene_structure: string[] — EXACTLY 9 strings.
   Panels 1–8: "Thumbnail: 9:16 vertical — [vivid environment, NO human faces] | STORY: [overlay text] | CAMERA: [camera action] | MOOD: [emotional tone]"
   Panel 9: "BRAND PANEL: [hex color] background. [Brand name] in large serif. [Benefit anchor 1]. [Benefit anchor 2]. No faces."
   All English. No Chinese. No human faces or bodies anywhere.

4. storyboard_image_prompt: string — A COMPLETE, SELF-CONTAINED ChatGPT Image prompt (200–400 words).
   This will be pasted DIRECTLY into ChatGPT Image with no editing — include every detail needed.
   Use this structure:
   "Create a professional video production storyboard document as a single image. This is for [ACTUAL BRAND NAME]'s '[ACTUAL CAMPAIGN TITLE]' Facebook Reels (15 seconds, [angle_tag] concept: [title]).
   DOCUMENT LAYOUT: Portrait orientation. Dark charcoal #1a1a1a background. Clean sans-serif typography. Title header bar: '[Brand] | [Campaign] | 15-sec Reel Storyboard'.
   3×3 PANEL GRID — 9 panels total, each labeled SCENE [N]:
   SCENE 1: [Expand scene_structure[0] into 3–4 sentences of precise visual direction — colors, objects, composition, lighting. 9:16 vertical thumbnail. No faces.]
   SCENE 2: [Same for scene_structure[1].]
   SCENE 3: [Same for scene_structure[2].]
   SCENE 4: [Same for scene_structure[3].]
   SCENE 5: [Same for scene_structure[4].]
   SCENE 6: [Same for scene_structure[5].]
   SCENE 7: [Same for scene_structure[6].]
   SCENE 8: [Same for scene_structure[7].]
   SCENE 9 — BRAND LOGO PANEL: [Expand scene_structure[8] — brand hex color background, brand name typography, anchor text, minimal layout.]
   BOTTOM STYLE GUIDE BAR: Color swatches ([brand hex colors if known]), font specimen, brand tagline.
   RENDERING REQUIREMENTS: English text labels only. Each panel thumbnail 9:16 vertical. No human faces or bodies. Photorealistic environments and objects. Print-ready quality."

5. seedance_i2v_prompt: string — A COMPLETE Seedance 2.0 Image-to-Video prompt (200–350 words).
   Used AFTER the storyboard image is generated to animate it into a 15-second video.
   MUST include all 8 sections with these exact labels:
   OVERALL NARRATIVE ARC: [2–3 sentences on the emotional journey from panel 1 to panel 9.]
   PACING AND TIMING: [Precise timing: "0–2s: ... 2–4s: ... 4–7s: ... 7–10s: ... 10–12s: ... 12–15s: ..." Total = 15s.]
   CAMERA MOVEMENT STYLE: [Specific moves per scene: "Scene 1: slow push-in. Scene 2: gentle pan right." etc.]
   COLOR GRADE: [Overall color treatment and LUT style.]
   LIGHTING: [Quality and direction of light across the video.]
   TRANSITIONS: [How scenes cut or flow: dissolves, hard cuts, zoom transitions, etc.]
   BRAND PANEL: Hold final brand panel for 3 seconds. [Describe brand panel appearance.]
   TECHNICAL REQUIREMENTS: 9:16 vertical. 15 seconds total. Facebook Reels silent autoplay optimised. No human faces. English only.

6. caption: string — Facebook Reels caption. AU/NZ English. 2–3 short paragraphs. Clear CTA. 5–8 hashtags at end.

7. hashtags: string[] — standalone array of 5–8 hashtags.

8. angle_tag: one of "price_attack"|"speed_attack"|"trust_attack"|"pet_floor"|"scarcity"|"seasonal"
   Choose 3 different angle_tags across the 3 reels.

CRITICAL RULES:
- All text fields in English only — zero Chinese characters
- scene_structure MUST be EXACTLY 9 strings
- storyboard_image_prompt MUST be 200–400 words (complete standalone prompt)
- seedance_i2v_prompt MUST be 200–350 words with all 8 labelled sections
- No human faces or bodies in any visual description
Return ONLY a raw JSON array — no markdown, no code fences, no explanation.`

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
  return `## Brand Brief
${briefText}${campaign}${viral}

## Channel Strategy
Theme: ${strategy.theme}
Content Pillars: ${strategy.content_pillars.join(', ')}
Campaign Focus: ${strategy.campaign_focus}
Tone: ${strategy.tone_guidance}

Generate 3 Facebook Reels scripts with ALL required fields.

IMPORTANT:
- Use the ACTUAL brand name and campaign title from the brief above when writing storyboard_image_prompt (not placeholders).
- scene_structure MUST be exactly 9 strings; index 8 MUST be the brand panel.
- storyboard_image_prompt: write as a complete, ready-to-paste ChatGPT Image prompt (200–400 words) — expand each scene_structure entry into 3–4 sentences of visual direction.
- seedance_i2v_prompt: write exactly 200–350 words covering all 8 required sections (OVERALL NARRATIVE ARC, PACING AND TIMING, CAMERA MOVEMENT STYLE, COLOR GRADE, LIGHTING, TRANSITIONS, BRAND PANEL, TECHNICAL REQUIREMENTS).
- Choose 3 distinct angle_tags across the 3 reels.`
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
    temperature: 0.75,
    max_tokens: 8000,  // storyboard + seedance prompts are verbose (3 reels × ~900 words each)
    messages: [
      { role: 'system', content: SYSTEM_REELS },
      { role: 'user', content: buildReelsPrompt(strategy, briefText, campaignText, viralInsightsText) },
    ],
  })

  const raw = resp.choices[0].message.content ?? '[]'
  const scripts = parseOpenAIJson<ReelsScript[]>(raw)
  return scripts.map(s => ({
    ...s,
    scene_structure: normaliseSceneStructure(s.scene_structure),
  }))
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

// ─── Internal helpers ──────────────────────────────────────────────────────────

/** Ensure scene_structure is always exactly 9 non-empty-padded strings. */
function normaliseSceneStructure(raw: unknown): string[] {
  const arr = Array.isArray(raw) ? raw.map(String) : []
  while (arr.length < 9) arr.push('')
  return arr.slice(0, 9)
}

