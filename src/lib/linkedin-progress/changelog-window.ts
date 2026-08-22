/**
 * Reads docs/history/CHANGELOG.md and selects the entries relevant to one
 * cron fire of the LinkedIn progress-post pipeline.
 *
 * No state is stored anywhere (no "last posted" pointer) — the lookback
 * window is derived purely from which weekday the NZ-local calendar says it
 * is right now: Monday looks back to the previous Thursday, Thursday looks
 * back to the previous Monday. A missed cron fire just shrinks that week's
 * window instead of silently duplicating or back-filling — acceptable for a
 * low-stakes weekly post, and it avoids a migration for this feature entirely.
 */

import { readFile } from 'fs/promises'
import path from 'path'

export interface ChangelogEntry {
  /** YYYY-MM-DD, parsed from the "### YYYY-MM-DD ..." heading. */
  date: string
  /** Heading text after the date (title / phase tag), trimmed. */
  heading: string
  body: string
}

const CHANGELOG_PATH = path.join(process.cwd(), 'docs/history/CHANGELOG.md')

// "### 2026-08-04（标题...)" — only the leading date is load-bearing; the rest
// of the heading (including "（续）" variants) is free text we don't parse further.
const HEADING_RE = /^###\s+(\d{4}-\d{2}-\d{2})(.*)$/

/**
 * CHANGELOG.md has real, historical mojibake in it (confirmed by inspection —
 * some 2026-06 entries have Chinese punctuation corrupted into stray Latin-1
 * supplement bytes). Never feed a corrupted entry into the LLM — skip it and
 * log, rather than let garbled bytes leak into a public post.
 */
const CORRUPTION_RATIO_THRESHOLD = 0.02

function looksCorrupted(text: string): boolean {
  if (!text) return false
  let bad = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (ch === '�') { bad++; continue }
    // Latin-1 supplement C1 control range — where mis-decoded UTF-8 Chinese
    // punctuation lands after a double-encode/decode round trip.
    if (code >= 0x80 && code <= 0x9f) bad++
  }
  return bad / text.length > CORRUPTION_RATIO_THRESHOLD
}

/**
 * Parses the full CHANGELOG text into entries. The file is newest-first in
 * general, but that ordering is NOT a reliable invariant (the archive/history
 * section has out-of-order dates from past merges) — callers must filter by
 * parsed date, never by position. A single date can also have multiple
 * headings (multiple same-day entries, or "（续）"/"（续 2）" continuations) —
 * all are collected, not just the first.
 */
export function parseChangelog(raw: string): ChangelogEntry[] {
  const lines = raw.split('\n')
  const entries: ChangelogEntry[] = []
  let current: { date: string; heading: string; bodyLines: string[] } | null = null

  const flush = () => {
    if (!current) return
    const body = current.bodyLines.join('\n').trim()
    if (looksCorrupted(current.heading) || looksCorrupted(body)) {
      console.warn(`[linkedin-progress] CHANGELOG entry dated ${current.date} looks corrupted — skipping`)
    } else if (body) {
      entries.push({ date: current.date, heading: current.heading.trim(), body })
    }
    current = null
  }

  for (const line of lines) {
    const m = HEADING_RE.exec(line)
    if (m) {
      flush()
      current = { date: m[1], heading: m[2] ?? '', bodyLines: [] }
    } else if (current) {
      current.bodyLines.push(line)
    }
  }
  flush()

  return entries
}

export async function loadChangelogEntries(): Promise<ChangelogEntry[]> {
  const raw = await readFile(CHANGELOG_PATH, 'utf-8')
  return parseChangelog(raw)
}

const NZ_TIMEZONE = 'Pacific/Auckland'

/** 0=Sun..6=Sat, computed from NZ-local time regardless of the server's own timezone. */
export function nzWeekday(now: Date): number {
  const weekdayName = new Intl.DateTimeFormat('en-US', { timeZone: NZ_TIMEZONE, weekday: 'short' }).format(now)
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return names.indexOf(weekdayName)
}

/** NZ-local calendar date as YYYY-MM-DD, regardless of the server's own timezone. */
export function nzDateString(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: NZ_TIMEZONE }).format(now)
}

/**
 * Days back to compute the (exclusive) cutoff date, keyed by NZ weekday.
 * Monday (1) → cutoff = last Thursday, covering Fri/Sat/Sun/Mon (Thursday
 * itself excluded — that day belonged to Thursday's own run). Thursday (4) →
 * cutoff = this Monday, covering Tue/Wed/Thu. Any other weekday (manual test
 * trigger, off-schedule curl) defaults to the Thursday window — the shorter
 * of the two.
 */
function lookbackDays(weekday: number): number {
  return weekday === 1 ? 4 : 3
}

export function changelogCutoffDate(now: Date): string {
  const days = lookbackDays(nzWeekday(now))
  const cutoff = new Date(now.getTime() - days * 86_400_000)
  return nzDateString(cutoff)
}

/**
 * Entries with date STRICTLY AFTER cutoff (never >=), compared as ISO date
 * strings (safe: fixed YYYY-MM-DD width).
 *
 * The cutoff day itself must be excluded, not included: cutoffDate is always
 * the previous run's own "today" (Monday's cutoff = last Thursday, Thursday's
 * own run date; Thursday's cutoff = this Monday, Monday's own run date) —
 * that day was already reported by the run that owned it as "today". An
 * inclusive >= here would report that boundary day's entries twice, once in
 * each of two consecutive posts.
 */
export function entriesSince(entries: ChangelogEntry[], cutoffDate: string): ChangelogEntry[] {
  return entries.filter((e) => e.date > cutoffDate)
}

export async function loadChangelogWindow(now: Date = new Date()): Promise<{
  cutoffDate: string
  entries: ChangelogEntry[]
}> {
  const cutoffDate = changelogCutoffDate(now)
  const all = await loadChangelogEntries()
  return { cutoffDate, entries: entriesSince(all, cutoffDate) }
}
