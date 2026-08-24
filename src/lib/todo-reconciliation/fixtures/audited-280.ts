/**
 * Frozen fixture — the 280-item composition audited in #1169 (production
 * `pm-daily-todo` run `2026-08-23T19:00:47Z`, `origin/main`
 * `5248ba669bd5b84f648b9f6390d8a800114f8251`).
 *
 * Structured and de-identified: no real customer content, keyword, or
 * message text — only the client codenames (`CTS`, `oztop`, `Roman`) already
 * used throughout this repository's own fixtures/tests, plus the counts and
 * verdict/job-name breakdown recorded in the #1169 audit table. This is a
 * fixed dataset for deterministic reconciliation testing/preview — it is
 * never read from or written to production.
 *
 * `AUDITED_280_ASOF` is the reference "now" the fixture was captured at —
 * `reconcile()` takes it as an explicit parameter so same-day/ageing checks
 * stay deterministic instead of depending on the wall clock.
 */

import type { RawWorkItem } from '../types'

export const AUDITED_280_ASOF = '2026-08-24T00:00:00.000Z'

const CTS = { id: 'c0000000-0000-0000-0000-000000000000', name: 'CTS' }
const OZTOP = { id: 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84', name: 'oztop' }
const ROMAN = { id: 'e1a2b3c4-0000-0000-0000-000000000001', name: 'Roman' }

let seq = 0
function nextId(prefix: string): string {
  seq += 1
  return `${prefix}-${String(seq).padStart(4, '0')}`
}

function repeat<T>(count: number, build: (i: number) => T): T[] {
  return Array.from({ length: count }, (_, i) => build(i))
}

// ─── 1. Manual lane — 140 rows (audit table) ────────────────────────────────

function buildUrlIndexingRows(): RawWorkItem[] {
  const OLD_DATE = '2026-07-20T00:00:00.000Z'

  const client = (
    who: typeof CTS | typeof OZTOP,
    verdict: string,
    count: number,
    createdAt = OLD_DATE,
  ): RawWorkItem[] =>
    repeat(count, () => ({
      id: nextId('url'),
      source: 'manual_item',
      category: 'url_indexing',
      clientId: who.id,
      clientName: who.name,
      // Kept rows collapse per client×verdict — one reviewable cluster per
      // (client, indexing verdict) pair, not one row per URL.
      rootCauseKey: `url_indexing:${who.name}:${verdict}`,
      label: `${who.name} URL indexing verdict: ${verdict}`,
      verdict,
      createdAt,
    }))

  return [
    // oztop: 59 + 43 + 10 + 3 + 1 + 1 + 4 = 121
    ...client(OZTOP, 'crawled_not_indexed', 59),
    ...client(OZTOP, 'discovered_not_indexed', 43),
    ...client(OZTOP, 'intentional_noindex', 10),
    ...client(OZTOP, 'redirect', 3),
    ...client(OZTOP, 'duplicate_canonical', 1),
    ...client(OZTOP, 'alternate_canonical', 1),
    ...client(OZTOP, 'unknown_to_google', 4),
    // CTS: 4 + 1 = 5, the 4 discovered the same day as the audit run.
    ...client(CTS, 'unknown_to_google', 4, AUDITED_280_ASOF),
    ...client(CTS, 'duplicate_canonical', 1),
  ] // 126 total
}

function manualSingle(category: string, clientName: string | null, label: string): RawWorkItem {
  return {
    id: nextId('manual'),
    source: 'manual_item',
    category,
    clientId: null,
    clientName,
    rootCauseKey: `manual:${category}:${nextId('rc')}`,
    label,
  }
}

function buildManualLane(): RawWorkItem[] {
  return [
    ...buildUrlIndexingRows(), // 126
    ...repeat(4, (i) => manualSingle('diagnostic_summary', null, `Diagnostic summary ${i + 1}`)),
    ...repeat(2, (i) => manualSingle('goal_baseline_mismatch', null, `Goal baseline mismatch ${i + 1}`)),
    // Duplicates the same work already counted under blog_draft rows below.
    ...repeat(2, (i) => manualSingle('blog_draft_summary', i === 0 ? CTS.name : OZTOP.name, `Blog draft awaiting review (summary card)`)),
    manualSingle('meta_queue_stuck', null, 'Meta publishing queue stuck'),
    manualSingle('local_factory_worker_idle', null, 'Local content-factory worker idle'),
    manualSingle('auto_run_blocked', null, 'Auto-run execution blocked'),
    manualSingle('leads_metric_untrusted', null, 'Leads metric could not be verified'),
    manualSingle('cron_not_running', null, 'Scheduled job is not firing at all'),
    manualSingle('dnc_ambiguity', null, 'Ambiguous do-not-contact request needs a human read'),
  ] // 140 total
}

// ─── 2. Cron failures — 77 rows across 7 job names ──────────────────────────

function buildCronFailures(): RawWorkItem[] {
  const job = (name: string, count: number): RawWorkItem[] =>
    repeat(count, () => ({
      id: nextId('cron'),
      source: 'cron_failure',
      category: 'cron_job',
      clientId: null,
      clientName: null,
      rootCauseKey: `cron:${name}`,
      label: `Cron job failing: ${name}`,
    }))

  return [
    ...job('social-comment-autoreply', 48),
    ...job('meta-leads-sync', 24),
    ...job('market-intel-daily', 1),
    ...job('winner-reel-sync-daily', 1),
    ...job('ad-readback-sweep', 1),
    ...job('google-data-pullback-daily', 1),
    ...job('cms-connection-retest', 1),
  ] // 77 total
}

// ─── 3. Execution cards — 40 rows (25 me_auto, 15 fde_manual) ───────────────

function buildExecutionCards(): RawWorkItem[] {
  const card = (fixType: 'me_auto' | 'fde_manual', who: typeof CTS | typeof OZTOP): RawWorkItem => ({
    id: nextId('card'),
    source: 'execution_card',
    category: 'execution_card',
    clientId: who.id,
    clientName: who.name,
    rootCauseKey: `execution_card:${nextId('rc')}`,
    label: `${fixType === 'me_auto' ? 'Machine-executable' : 'FDE-manual'} execution card`,
    fixType,
  })

  return [
    ...repeat(25, (i) => card('me_auto', i % 2 === 0 ? CTS : OZTOP)),
    ...repeat(15, (i) => card('fde_manual', i % 2 === 0 ? CTS : OZTOP)),
  ] // 40 total
}

// ─── 4. Reels awaiting review — 14 rows ─────────────────────────────────────

function buildReels(): RawWorkItem[] {
  const reel = (status: string, createdAt: string): RawWorkItem => ({
    id: nextId('reel'),
    source: 'reel_review',
    category: 'reel_review',
    clientId: OZTOP.id,
    clientName: OZTOP.name,
    rootCauseKey: `reel:${nextId('rc')}`,
    label: 'Social reel awaiting review',
    reelStatus: status,
    createdAt,
  })

  return [
    // Genuinely still open — old, but nobody has ever looked at them.
    ...repeat(5, (i) => reel('in_review', `2026-0${6 + (i % 2)}-1${i}T00:00:00.000Z`)),
    // Already reached a terminal state; the raw feed just never dropped them.
    ...repeat(9, (i) => reel(['published', 'approved', 'rejected'][i % 3], `2026-0${5 + (i % 3)}-0${1 + (i % 8)}T00:00:00.000Z`)),
  ] // 14 total
}

// ─── 5. Blog drafts — 6 rows (2 CTS + 4 oztop) ──────────────────────────────

function buildBlogDrafts(): RawWorkItem[] {
  const draft = (who: typeof CTS | typeof OZTOP): RawWorkItem => ({
    id: nextId('blog'),
    source: 'blog_draft',
    category: 'blog_draft',
    clientId: who.id,
    clientName: who.name,
    rootCauseKey: `blog_draft:${nextId('rc')}`,
    label: `${who.name} blog draft awaiting review`,
  })

  return [
    ...repeat(2, () => draft(CTS)),
    ...repeat(4, () => draft(OZTOP)),
  ] // 6 total
}

// ─── 6. GBP setup — 3 rows (CTS/oztop already connected, Roman real gate) ───

function buildGbpSetup(): RawWorkItem[] {
  const row = (who: typeof CTS | typeof OZTOP | typeof ROMAN, category: string): RawWorkItem => ({
    id: nextId('gbp'),
    source: 'gbp_setup',
    category,
    clientId: who.id,
    clientName: who.name,
    rootCauseKey: `gbp:${who.name}`,
    label: `${who.name} Google Business Profile setup`,
  })

  return [
    row(CTS, 'already_connected'),
    row(OZTOP, 'already_connected'),
    row(ROMAN, 'needs_oauth'),
  ] // 3 total
}

/** Builds the full 280-item fixture, deterministically (no Date.now/Math.random). */
export function buildAudited280(): RawWorkItem[] {
  seq = 0
  return [
    ...buildManualLane(), // 140
    ...buildCronFailures(), // 77
    ...buildExecutionCards(), // 40
    ...buildReels(), // 14
    ...buildBlogDrafts(), // 6
    ...buildGbpSetup(), // 3
  ] // 280 total
}
