/**
 * Turns a window of CHANGELOG.md entries into one English LinkedIn post,
 * written in the founder's own first-person "build in public" voice.
 *
 * This is the only creative step in an otherwise fully unattended pipeline —
 * the guardrails below are prompt-level (see sensitive-filter.ts for the
 * code-level backstop that catches what this prompt misses).
 */

import { callClaudeChat } from '@/lib/anthropic/client'
import type { ChangelogEntry } from './changelog-window'

const SYSTEM_PROMPT = `You write LinkedIn posts for a solo founder building an AI-native business-operations platform (marketing automation is one feature of it, not the whole product) for small businesses in Australia and New Zealand. You are given this week's internal engineering changelog entries and must turn them into ONE LinkedIn post in the founder's own voice.

Hard rules — breaking any of these makes the post unpublishable:
1. Only describe what is actually in the changelog entries below. Never invent a feature, a number, a customer, or a result that isn't explicitly there.
2. Never name a specific client, customer, or company (even a well-known partner) and never repeat a client's operational numbers (lead counts, revenue, response times, etc.) even without naming them — describe the underlying product capability or improvement in general terms instead. If an entry is ONLY about one client's specific situation with no generalizable product story, leave it out entirely rather than reword around it.
3. Never use internal codenames, project names, phase/ticket IDs, or engineering jargon (e.g. migration, schema, RLS, rebase, enum, cron, PGRST). Translate every idea into plain language a non-technical reader would understand.
4. Write in first person, as the founder. Tone: honest, specific, a little understated — never hype-y. Do not use words like "revolutionary", "game-changing", "cutting-edge", or "excited to announce".
5. No sales pitch, no call-to-action to buy/sign up/book a demo. This is a progress update, not an ad.
6. Length: roughly 800–1300 characters. Plain text only — no markdown, no bullet characters, no headers.
7. You may end with up to 3 relevant, understated hashtags on their own line (e.g. topics like building in public, SaaS, or NZ/AU tech) — never more than 3, never generic spam tags.

Output ONLY the post text, nothing else — no preamble, no explanation, no quotation marks around it.`

export async function draftLinkedinPost(entries: ChangelogEntry[]): Promise<string> {
  const material = entries
    .map((e) => `### ${e.date} ${e.heading}\n${e.body}`)
    .join('\n\n---\n\n')

  const userMessage = `This week's changelog entries (most recent shipped work, already-live only):\n\n${material}\n\nWrite the LinkedIn post now.`

  const result = await callClaudeChat({
    systemPrompt: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    maxOutputTokens: 1024,
  })

  return result.text.trim()
}

// ── Format backstop ──────────────────────────────────────────────────────────
//
// The length/hashtag/plain-text rules above (SYSTEM_PROMPT rules 6–7) are
// prompt-level only — nothing stops the LLM from drifting on an off week.
// This is a second, code-level check on the LLM's own output; a violation
// routes the post to human review instead of auto-publishing, same as the
// sensitive-content backstop in sensitive-filter.ts.

export interface FormatViolation {
  rule: 'length' | 'hashtag_count' | 'markdown'
  detail: string
}

const MIN_LENGTH = 800
const MAX_LENGTH = 1300
const MAX_HASHTAGS = 3

/** Headers, bold/italic markers, bullet/numbered lists, links, inline code. */
const MARKDOWN_PATTERNS: RegExp[] = [
  /^#{1,6}\s/m,
  /\*\*[^*\n]+\*\*/,
  /^[-*+]\s/m,
  /^\d+\.\s/m,
  /\[[^\]]+\]\([^)]+\)/,
  /`[^`\n]+`/,
]

export function validateDraftFormat(text: string): FormatViolation[] {
  const violations: FormatViolation[] = []

  if (text.length < MIN_LENGTH || text.length > MAX_LENGTH) {
    violations.push({
      rule: 'length',
      detail: `${text.length} chars (expected ${MIN_LENGTH}-${MAX_LENGTH})`,
    })
  }

  const hashtagCount = (text.match(/#\w+/g) ?? []).length
  if (hashtagCount > MAX_HASHTAGS) {
    violations.push({ rule: 'hashtag_count', detail: `${hashtagCount} hashtags (max ${MAX_HASHTAGS})` })
  }

  if (MARKDOWN_PATTERNS.some((re) => re.test(text))) {
    violations.push({ rule: 'markdown', detail: 'contains markdown syntax (header/bold/list/link/code)' })
  }

  return violations
}
