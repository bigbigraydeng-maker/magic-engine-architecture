/**
 * Viral Style Advisor — Phase 11.0-R
 *
 * Queries the viral reference library by industry + content_goal,
 * orders by view_count (most viral first), formats a style hint block
 * for injection into the Reel generation prompt.
 */

import { supabaseAdmin } from '@/lib/supabase'

export type ContentGoal = 'brand' | 'sales' | 'ugc' | 'education'

/**
 * Returns a formatted style guidance block, or null if no done references exist.
 * References are ordered by view_count desc — most viral examples weigh heaviest.
 */
const FIELDS = 'id, style_description, style_tags, key_techniques, persona_fit, view_count, video_title, channel_title, opening_hook'

export interface ViralRef {
  id?: string | null
  video_title?: string | null
  style_description?: string | null
  style_tags?: string[] | null
  key_techniques?: string[] | null
  view_count?: number | null
  opening_hook?: { type?: string; script?: string; feel?: string } | null
}

export interface ViralPlanContext {
  campaignAngle?: string | null
  maxContinuousI2vSeconds: number
  overlayRoles?: readonly string[]
}

export interface ViralVisualPlan {
  schema_version: 1
  reference_ids: string[]
  references: Array<{
    id: string
    score: number
    hook_type: string | null
    techniques: string[]
  }>
  selection_reason: string
  hook_pattern: string
  shot_grammar: string[]
  edit_rhythm: string
  overlay_pattern: string
  prohibited_patterns: string[]
  prompt_directive: string
}

const AUDIO_ONLY = /audio|sound|music|voice|voiceover|narration|asmr|song|beat/i
const UNSUITABLE_VISUAL = /dance|choreograph|meme|prank|reaction|talking[ -]?head|instagram vs\.? reality|static[ -]?camera/i
const STRONG_VISUAL = /cinematic|dynamic|reveal|close[ -]?up|fast[ -]?cut|text[ -]?overlay|destination|landscape|architecture|detail|zoom|drone|tracking|parallax/i

function normalizedWords(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []
}

/**
 * Rank by client/campaign fit first and reach second. This deliberately avoids
 * treating the most-viewed dance/meme as a suitable travel-ad art director.
 */
export function rankViralRefs(refs: ViralRef[], context: ViralPlanContext): ViralRef[] {
  const angleWords = new Set(normalizedWords(context.campaignAngle ?? ''))
  return refs
    .filter((ref) => typeof ref.id === 'string' && ref.id.trim().length > 0)
    .map((ref, index) => ({ ref, index, score: scoreViralRef(ref, angleWords) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ ref }) => ref)
}

function scoreViralRef(ref: ViralRef, angleWords: Set<string>): number {
  const text = [
    ref.video_title,
    ref.style_description,
    ...(ref.style_tags ?? []),
    ...(ref.key_techniques ?? []),
    ref.opening_hook?.type,
    ref.opening_hook?.feel,
  ].filter(Boolean).join(' ').toLowerCase()
  let value = Math.min(9, Math.log10(Math.max(1, ref.view_count ?? 1))) * 0.1
  if (STRONG_VISUAL.test(text)) value += 4
  if (UNSUITABLE_VISUAL.test(text)) value -= 8
  for (const word of Array.from(angleWords)) if (text.includes(word)) value += 0.5
  return Math.round(value * 100) / 100
}

export function buildViralVisualPlan(
  refs: ViralRef[],
  industry: string,
  contentGoal: ContentGoal,
  context: ViralPlanContext,
): ViralVisualPlan | null {
  if (!Number.isFinite(context.maxContinuousI2vSeconds) || context.maxContinuousI2vSeconds <= 0) return null
  const selected = rankViralRefs(refs, context).slice(0, 3)
  if (selected.length === 0) return null

  const visualTechniques = selected
    .flatMap((ref) => ref.key_techniques ?? [])
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value && !AUDIO_ONLY.test(value) && !UNSUITABLE_VISUAL.test(value))
  const shotGrammar = Array.from(new Set(visualTechniques)).slice(0, 4)
  if (shotGrammar.length === 0) return null
  const hookPattern = selected
    .map((ref) => ref.opening_hook?.type?.trim().toLowerCase())
    .find((value) => value && !UNSUITABLE_VISUAL.test(value)) ?? 'visual-surprise'
  const overlayRoles = context.overlayRoles?.length ? context.overlayRoles.join(' + ') : 'hook only'
  const maxSeconds = Math.round(context.maxContinuousI2vSeconds * 10) / 10
  const angleWords = new Set(normalizedWords(context.campaignAngle ?? ''))
  const promptDirective = [
    `viral-v2 ${industry} ${contentGoal}`,
    `open with ${hookPattern}`,
    `shot grammar: ${shotGrammar.join(', ')}`,
    `each continuous I2V shot <= ${maxSeconds}s`,
    'use distinct source composition per cut',
  ].join('; ')

  return {
    schema_version: 1,
    reference_ids: selected.map((ref) => ref.id!.trim()),
    references: selected.map((ref) => ({
      id: ref.id!.trim(),
      score: scoreViralRef(ref, angleWords),
      hook_type: ref.opening_hook?.type?.trim().toLowerCase() ?? null,
      techniques: (ref.key_techniques ?? [])
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value && !AUDIO_ONLY.test(value))
        .slice(0, 4),
    })),
    selection_reason: `semantic fit for ${industry}/${contentGoal} and dynamic visual compatibility; view count used only as a secondary signal`,
    hook_pattern: hookPattern,
    shot_grammar: shotGrammar,
    edit_rhythm: `multi-cut; every continuous I2V shot <= ${maxSeconds}s`,
    overlay_pattern: `${overlayRoles}; short distinct lines, never copied from a reference`,
    prohibited_patterns: [
      `continuous I2V shot longer than ${maxSeconds}s`,
      'static-photo slideshow or Ken Burns motion',
      'copied reference wording or scene recreation',
    ],
    prompt_directive: promptDirective,
  }
}

/**
 * Top-5 references for an industry, most-viral first.
 *
 * Extracted so the two consumers (the long prompt block below, and the content
 * factory's compact clip directive) share one query — the filters here encode
 * real rules (`is_learnable` = good views, `is_our_video` = don't learn from
 * ourselves) and having them drift between callers would be a silent quality bug.
 */
export async function fetchViralRefs(
  industry: string,
  contentGoal: ContentGoal = 'brand',
): Promise<ViralRef[]> {
  // Exact content_goal match first; only learnable and not our own videos.
  const { data: exact } = await supabaseAdmin
    .from('viral_reference_library')
    .select(FIELDS)
    .eq('industry', industry)
    .eq('analysis_status', 'done')
    .eq('content_goal', contentGoal)
    .eq('is_learnable', true)
    .eq('is_our_video', false)
    .order('view_count', { ascending: false, nullsFirst: false })
    .limit(5)
  if (exact && exact.length > 0) return exact as ViralRef[]

  // Fallback: any goal, still learnable + not ours
  const { data: fallback } = await supabaseAdmin
    .from('viral_reference_library')
    .select(FIELDS)
    .eq('industry', industry)
    .eq('analysis_status', 'done')
    .eq('is_learnable', true)
    .eq('is_our_video', false)
    .order('view_count', { ascending: false, nullsFirst: false })
    .limit(5)
  return (fallback ?? []) as ViralRef[]
}

async function fetchViralPlanRefs(industry: string, contentGoal: ContentGoal): Promise<ViralRef[]> {
  const exact = await supabaseAdmin
    .from('viral_reference_library')
    .select(FIELDS)
    .eq('industry', industry)
    .eq('analysis_status', 'done')
    .eq('content_goal', contentGoal)
    .eq('is_learnable', true)
    .eq('is_our_video', false)
    .order('view_count', { ascending: false, nullsFirst: false })
    .limit(25)
  if (exact.data && exact.data.length > 0) return exact.data as ViralRef[]
  const fallback = await supabaseAdmin
    .from('viral_reference_library')
    .select(FIELDS)
    .eq('industry', industry)
    .eq('analysis_status', 'done')
    .eq('is_learnable', true)
    .eq('is_our_video', false)
    .order('view_count', { ascending: false, nullsFirst: false })
    .limit(25)
  return (fallback.data ?? []) as ViralRef[]
}

export async function getViralVisualPlan(
  industry: string,
  contentGoal: ContentGoal,
  context: ViralPlanContext,
): Promise<ViralVisualPlan | null> {
  const refs = await fetchViralPlanRefs(industry, contentGoal)
  return buildViralVisualPlan(refs, industry, contentGoal, context)
}

export async function getViralStyleHint(
  industry: string,
  contentGoal: ContentGoal = 'brand'
): Promise<string | null> {
  const refs = await fetchViralRefs(industry, contentGoal)
  if (refs.length === 0) return null

  // Separate hook data for aggregated summary (top 3 hook types across all refs)
  const hookTypes = refs
    .map(r => (r.opening_hook as { type?: string } | null)?.type)
    .filter((t): t is string => Boolean(t))
  const hookFreq = new Map<string, number>()
  for (const t of hookTypes) hookFreq.set(t, (hookFreq.get(t) ?? 0) + 1)
  const topHooks = Array.from(hookFreq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3)

  const examples = refs
    .filter(r => r.style_description)
    .map((r, i) => {
      const hook = r.opening_hook as { type?: string; script?: string; feel?: string } | null
      const parts: string[] = []
      const viewBadge = r.view_count
        ? ` [${formatViewCount(r.view_count)} views]`
        : ''
      parts.push(`${i + 1}.${viewBadge} ${r.style_description}`)
      if (hook?.type) {
        const hookLine = hook.script
          ? `   Hook (first 1.5s): ${hook.type} — "${hook.script}"${hook.feel ? ` (${hook.feel})` : ''}`
          : `   Hook (first 1.5s): ${hook.type}${hook.feel ? ` (${hook.feel})` : ''}`
        parts.push(hookLine)
      }
      if (r.key_techniques?.length) parts.push(`   Techniques: ${r.key_techniques.join(', ')}`)
      if (r.style_tags?.length)     parts.push(`   Tags: ${r.style_tags.join(', ')}`)
      return parts.join('\n')
    })

  if (examples.length === 0) return null

  const goalLabel = contentGoal === 'sales'     ? 'Sales/Conversion'
                  : contentGoal === 'ugc'       ? 'UGC/Social Proof'
                  : contentGoal === 'education' ? 'Educational'
                  : 'Brand/Inspiration'

  const hookSummaryLine = topHooks.length > 0
    ? `Top opening hook patterns in this industry: ${topHooks.map(([t, n]) => `${t} (×${n})`).join(', ')}.`
    : null

  return [
    `## Proven ${industry} ${goalLabel} Video Style References`,
    `Study these high-performing video patterns (ranked by view count) and incorporate their best elements naturally:`,
    '',
    ...examples,
    '',
    hookSummaryLine
      ? `OPENING HOOK GUIDANCE: ${hookSummaryLine} Mirror the dominant hook style in your opening_frame_prompt and i2v_video_prompt opening section.`
      : null,
    `Apply the energy, visual language, and techniques above to this brief.`,
  ].filter((line): line is string => line !== null).join('\n')
}

/**
 * Compact, prompt-safe style directive for the content factory.
 *
 * Why not reuse getViralStyleHint(): that returns a multi-line study block with
 * examples and view counts — right for a text-LLM system prompt, wrong for an
 * i2v clip prompt, where the factory worker passes prompt_hint straight to the
 * video model. Long blocks there dilute the visual instruction and cost tokens
 * per clip. This returns one short phrase built from the same references:
 * the dominant opening-hook type plus the most common techniques.
 *
 * Returns null when the industry has no usable references (caller keeps its
 * original prompt untouched).
 */
export async function getViralClipDirective(
  industry: string,
  contentGoal: ContentGoal = 'brand',
): Promise<string | null> {
  const refs = await fetchViralRefs(industry, contentGoal)
  if (refs.length === 0) return null

  const topBy = (values: string[], n: number): string[] => {
    const freq = new Map<string, number>()
    for (const v of values) {
      const k = v.trim().toLowerCase()
      if (k) freq.set(k, (freq.get(k) ?? 0) + 1)
    }
    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k]) => k)
  }

  // 剔掉纯声音类手法:这段字最终喂给 image-to-video 模型,只能描述画面。
  // 实库里 travel 前三高频就有 "meme-audio-integration" —— 喂进画面提示词是纯噪音。
  // 只排明确属于声音的,不做主观好坏判断(那属于人的编辑决定,不是这里该猜的)。
  const isVisual = (t: string) => !AUDIO_ONLY.test(t)

  const hooks = topBy(refs.map((r) => r.opening_hook?.type ?? '').filter(Boolean), 1)
  const techniques = topBy(refs.flatMap((r) => r.key_techniques ?? []).filter(isVisual), 3)

  const parts: string[] = []
  if (hooks.length > 0) parts.push(`open with a ${hooks[0]} hook`)
  if (techniques.length > 0) parts.push(techniques.join(', '))
  if (parts.length === 0) return null

  return `proven ${industry} style: ${parts.join('; ')}`
}

function formatViewCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

/**
 * Detect content goal from campaign brief fields.
 * Sales signals: explicit offer + action-oriented CTA, or urgency words in angle.
 */
export function detectContentGoal(brief: {
  offer?: string | null
  primary_cta?: string | null
  campaign_angle?: string | null
  channel_goal?: string | null
}): ContentGoal {
  const offer       = (brief.offer ?? '').trim()
  const cta         = (brief.primary_cta ?? '').trim().toLowerCase()
  const angle       = (brief.campaign_angle ?? '').toLowerCase()
  const channelGoal = (brief.channel_goal ?? '').toLowerCase()

  const SALES_CTA_VERBS = ['book', 'buy', 'reserve', 'get', 'shop', 'order', 'claim', 'grab']
  const hasActionCta = SALES_CTA_VERBS.some(v => cta.includes(v))
  const hasOffer = offer.length > 0 && !/awareness|brand|generic/i.test(offer)

  const URGENCY_WORDS = ['limited', 'last chance', 'ending', 'expires', 'today', 'now', 'hurry', 'deal']
  const hasUrgency = URGENCY_WORDS.some(w => angle.includes(w) || channelGoal.includes(w))

  if ((hasOffer && hasActionCta) || hasUrgency) return 'sales'

  return 'brand'
}
