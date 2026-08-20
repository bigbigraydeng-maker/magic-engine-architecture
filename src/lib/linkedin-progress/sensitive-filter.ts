/**
 * Hard, code-level backstop for the LinkedIn progress-post pipeline.
 *
 * The LLM draft is instructed (prompt-level) to never mention real client
 * names or internal jargon, but CHANGELOG.md genuinely contains real client
 * names alongside real operational numbers (e.g. a specific client's stale-lead
 * count) — a prompt instruction alone is not a safety boundary for something
 * that publishes unattended under a real person's name. This is checked
 * against BOTH the raw CHANGELOG source text and the LLM's own output; a hit
 * on either side routes the post to human review instead of auto-publishing.
 *
 * This is deliberately a coarse net, not a precise one — false positives just
 * mean an otherwise-clean week gets reviewed once; false negatives mean a
 * real client's data goes out under the founder's name. Bias toward catching.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { LINKEDIN_PROGRESS_CLIENT_ID } from './constants'

export interface SensitiveMatch {
  term: string
  kind: 'client' | 'internal_codename' | 'internal_jargon'
}

/** Internal agent personas (docs/agents/*.md) — never belong in public copy. */
const INTERNAL_CODENAMES = [
  '子牙', '魏征', '华佗', '诸葛亮', '张骞', '司马徽', '鲁班', '达芬奇', '板桥', '狄仁杰',
]

/** Internal technical/process jargon that CLAUDE.md itself bans from external copy. */
const INTERNAL_JARGON = [
  'DAPE', 'migration', 'RLS', 'rebase', 'schema', 'enum', 'PGRST', 'cron', 'zhangqian', 'huatuo',
]

/** Phase tags like "P21.J.M1" — internal roadmap shorthand, meaningless (and odd-looking) externally. */
const PHASE_ID_RE = /\bP\d+(?:\.[A-Za-z0-9]+)+\b/g

function isAsciiWord(term: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9 .-]*$/.test(term)
}

function includesTerm(haystack: string, haystackLower: string, term: string): boolean {
  if (isAsciiWord(term)) {
    const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    return re.test(haystack)
  }
  return haystackLower.includes(term.toLowerCase())
}

/**
 * Real client names/domains + brand names, pulled live from the DB so a newly
 * onboarded client is protected without a code change. Excludes the pipeline's
 * own client record (Magic Lab Class) — that one legitimately appears in its
 * own content.
 */
export async function loadClientKeywords(): Promise<string[]> {
  const [{ data: clients }, { data: briefs }] = await Promise.all([
    supabaseAdmin.from('clients').select('name, domain').neq('id', LINKEDIN_PROGRESS_CLIENT_ID),
    supabaseAdmin.from('master_briefs').select('brand_name, client_id').neq('client_id', LINKEDIN_PROGRESS_CLIENT_ID),
  ])

  const keywords = new Set<string>()
  for (const c of (clients ?? []) as Array<{ name: string | null; domain: string | null }>) {
    if (c.name) keywords.add(c.name.trim())
    if (c.domain) keywords.add(c.domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim())
  }
  for (const b of (briefs ?? []) as Array<{ brand_name: string | null }>) {
    if (b.brand_name) keywords.add(b.brand_name.trim())
  }

  // Drop anything too short/generic to be a useful signal (avoids matching
  // every occurrence of a 1-2 char fragment).
  return Array.from(keywords).filter((k) => k.length >= 3)
}

export function findSensitiveMatches(text: string, clientKeywords: string[]): SensitiveMatch[] {
  const lower = text.toLowerCase()
  const matches: SensitiveMatch[] = []

  for (const kw of clientKeywords) {
    if (includesTerm(text, lower, kw)) matches.push({ term: kw, kind: 'client' })
  }
  for (const name of INTERNAL_CODENAMES) {
    if (text.includes(name)) matches.push({ term: name, kind: 'internal_codename' })
  }
  for (const term of INTERNAL_JARGON) {
    if (includesTerm(text, lower, term)) matches.push({ term, kind: 'internal_jargon' })
  }
  const phaseMatches = text.match(PHASE_ID_RE)
  if (phaseMatches) {
    for (const m of phaseMatches) matches.push({ term: m, kind: 'internal_jargon' })
  }

  return matches
}
