/**
 * Master Brief chat refinement.
 *
 * Lets users refine a brief through natural language.
 * Claude receives the current brief + conversation history,
 * returns a JSON patch with only the changed fields.
 *
 * Called by POST /api/clients/[id]/brief/[briefId]/chat
 */

import { callClaudeChat, parseJsonResponse } from '../anthropic/client'
import { BRIEF_REFINE_SYSTEM_PROMPT, buildRefineUserMessage } from './prompts'
import { supabaseAdmin } from '../supabase'
import type { MasterBrief, BriefChatMessage } from '@/types/magic-engine'

export interface RefineInput {
  briefId: string
  message: string
  history: BriefChatMessage[]
}

export interface RefineResult {
  success: boolean
  patch?: Partial<MasterBrief>
  reasoning?: string
  updatedBrief?: MasterBrief
  inputTokens?: number
  costUsd?: number
  error?: string
}

/**
 * Apply a natural language refinement request to an existing brief.
 * Fetches the current brief, calls Claude, applies the patch, and saves.
 */
export async function refineBrief(input: RefineInput): Promise<RefineResult> {
  // ── 1. Load current brief ─────────────────────────────────────────────────────
  const { data: brief, error: fetchError } = await supabaseAdmin
    .from('master_briefs')
    .select('*')
    .eq('id', input.briefId)
    .single()

  if (fetchError || !brief) {
    return { success: false, error: `Brief not found: ${fetchError?.message}` }
  }

  // ── 2. Build messages for Claude ──────────────────────────────────────────────
  const briefRecord = brief as Record<string, unknown>

  // Only pass the AI-owned fields to Claude (not metadata)
  const briefForPrompt = extractBriefFields(briefRecord)

  const messages = buildMessageHistory(input.history, briefForPrompt, input.message)

  // ── 3. Call Claude ────────────────────────────────────────────────────────────
  let claudeResult
  try {
    claudeResult = await callClaudeChat({
      systemPrompt: BRIEF_REFINE_SYSTEM_PROMPT,
      messages,
      maxOutputTokens: 4096,
    })
  } catch (err) {
    return { success: false, error: `Claude API error: ${(err as Error).message}` }
  }

  // ── 4. Parse patch ────────────────────────────────────────────────────────────
  let parsed: { reasoning: string; patch: Partial<MasterBrief> }
  try {
    parsed = parseJsonResponse(claudeResult.text)
  } catch (parseErr) {
    const preview = claudeResult.text.slice(0, 200)
    console.error('[brief/refine] JSON parse failed:', parseErr, '\nRaw preview:', preview)
    return {
      success: false,
      error: `Claude returned invalid JSON. Raw preview: ${preview}`,
    }
  }

  if (!parsed.patch || typeof parsed.patch !== 'object') {
    return { success: false, error: 'Claude returned an empty or invalid patch.' }
  }

  // ── 5. Apply patch to Supabase ────────────────────────────────────────────────
  const { data: updated, error: updateError } = await supabaseAdmin
    .from('master_briefs')
    .update({
      ...parsed.patch,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.briefId)
    .select()
    .single()

  if (updateError || !updated) {
    return {
      success: false,
      error: `Failed to save patch: ${updateError?.message ?? 'unknown'}`,
    }
  }

  return {
    success: true,
    patch: parsed.patch,
    reasoning: parsed.reasoning,
    updatedBrief: updated as MasterBrief,
    inputTokens: claudeResult.input_tokens + claudeResult.output_tokens,
    costUsd: claudeResult.cost_usd,
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract only the AI-managed content fields from a brief row.
 * Strips Supabase metadata fields (id, created_at, etc.) before sending to Claude.
 */
function extractBriefFields(row: Record<string, unknown>): Record<string, unknown> {
  const AI_FIELDS = [
    'brand_name', 'core_proposition', 'content_pillars', 'brand_voice',
    'target_audience', 'platform_strategy', 'keyword_seeds', 'competitor_domains',
    'vi_colors', 'vi_style_keywords', 'vi_dos', 'vi_donts',
    'brand_story_md', 'style_guide_md', 'competitive_notes_md',
  ]
  const result: Record<string, unknown> = {}
  for (const field of AI_FIELDS) {
    if (row[field] !== undefined) result[field] = row[field]
  }
  return result
}

/**
 * Build the multi-turn message array for the chat call.
 * Previous history is interleaved, then the new user request appended.
 */
function buildMessageHistory(
  history: BriefChatMessage[],
  brief: Record<string, unknown>,
  newMessage: string,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = []

  if (history.length === 0) {
    // First turn: inject the brief context in the first user message
    messages.push({
      role: 'user',
      content: buildRefineUserMessage({ brief, userRequest: newMessage }),
    })
  } else {
    // Subsequent turns: first user message had the brief; replay history
    // Inject brief context only in the first message
    const [firstMsg, ...restMsgs] = history
    messages.push({
      role: firstMsg.role,
      content: firstMsg.role === 'user'
        ? buildRefineUserMessage({ brief, userRequest: firstMsg.content })
        : firstMsg.content,
    })
    for (const msg of restMsgs) {
      messages.push({ role: msg.role, content: msg.content })
    }
    messages.push({ role: 'user', content: newMessage })
  }

  return messages
}
