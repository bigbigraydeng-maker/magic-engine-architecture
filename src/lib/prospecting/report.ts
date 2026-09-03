/**
 * Lead-leakage report builder — the client-facing artifact of the outbound
 * pipeline (the "free health check" hook for the $990 / 3-month offer).
 *
 * Reference: ROADMAP.md Phase 35. Deterministic, zero-AI, zero-cost: the AI
 * synthesis already happened in analyze.ts. This layer only RE-ORGANISES the
 * evidence already collected into a customer-readable "where are enquiries
 * leaking?" funnel, so:
 *   - every finding is grounded in a real signal (no invented numbers) —
 *     numbers used (reviews, rating, posts) come verbatim from the input;
 *   - no third-party vendor names leak into client copy (plain language only);
 *   - findings state facts, never promise an outcome (板桥 rule).
 *
 * The five funnel stages follow a real customer's path to enquiring, and each
 * maps 1:1 to a lever the 3-month service pulls:
 *   ① found   — do they even show up (Google + AI search)
 *   ② trust   — first-impression credibility (reviews, https, speed)
 *   ③ contact — can a ready customer reach you (form / phone / email)
 *   ④ alive   — does the storefront look open (social freshness)
 *   ⑤ engine  — are they going out to get leads, or waiting (ads + tracking)
 *
 * Output feeds two surfaces: `stages` renders the full report page, and
 * `summary_points` are the sharpest leaks written straight into the cold-email
 * body (value in the body — no attachment / link required to see it).
 */

import { INDUSTRY_LABELS, type ProspectAnalysis } from './analyze'
import type { ScoreSignal } from './score'
import type { TrackingSignals } from './tracking-detector'
import { difficultyBand, type KeywordReportItem } from './keyword-report'
import type { DiscoveryReport } from '@/lib/zhangqian/types'

export type LeakStatus = 'leak' | 'weak' | 'ok'   // 🔴 leaking / 🟡 soft spot / 🟢 solid

export type LeakStageKey = 'found' | 'trust' | 'contact' | 'alive' | 'engine'

export interface LeakStage {
  key:     LeakStageKey
  /** Customer-facing stage name (AU/NZ English). */
  label:   string
  status:  LeakStatus
  /** One plain-English sentence, grounded in a real signal. Empty stays out of the email. */
  finding: string
  /** What the 3-month service would do here — describes work, never promises a result. */
  fix:     string
}

/**
 * Anonymised traffic comparison (P35.14 · 板桥 rule: never name a competitor
 * to a Chinese-business-community reader — face matters, a named "you're
 * behind X" reads as an insult, not a diagnosis). `industry_avg_traffic` is
 * the mean of the discovered competitors' monthly traffic; `your_traffic` is
 * null when the prospect's own domain has no SEMrush signal.
 */
export interface IndustryBenchmark {
  your_traffic:         number | null
  industry_avg_traffic: number
  /** How many competitors fed the average — shown so the number isn't read as absolute truth. */
  sample_size:          number
}

/**
 * Verified official business registration (ABR/NZBN). `source_label` is
 * plain language for the report page's trust badge — 板桥 rule: always
 * pair this with a visible "public registry, anyone can look this up" line
 * so it reads as transparency, not surveillance.
 */
export interface VerifiedRegistration {
  identifier_type:  'ABN' | 'NZBN'
  registered_since: string | null
  source_label:     string
}

export interface LeakReport {
  generated_at:   string
  business_name:  string
  /** Headline for the report page + email subject seed. */
  headline:       string
  /** Count of stages currently leaking (status === 'leak'). */
  leak_count:     number
  /**
   * 0–100 lead-health score derived from the stages (100 = nothing leaking).
   * Always the rule-based funnel score, even when a full Discovery report is
   * available — P35.14 design decision: DiscoveryReport.diagnosis.scores is a
   * SEPARATE six-pillar AI score and must never become a second headline
   * number on this page (two scores on one page fight each other). Discovery
   * data only enriches evidence below, never the hero score.
   */
  health_score:   number
  /** Short verdict label keyed off the score, for the hero badge. */
  verdict:        string
  stages:         LeakStage[]
  /** Sharpest findings (leaks first, then soft spots) for the cold-email body. */
  summary_points: string[]
  /**
   * P35.14: real (anonymised) traffic comparison. `buildLeakReport()` always
   * sets this (to null when unavailable) — optional here only so hand-built
   * `LeakReport` fixtures elsewhere (e.g. outreach.test.ts) don't need it.
   */
  industry_benchmark?:    IndustryBenchmark | null
  /** P35.14: official registry verification. Null unless found and active. */
  verified_registration?: VerifiedRegistration | null
  /** P35.14: real keyword volumes from Discovery. Empty when unavailable — same shape as the existing $19.90-tier keyword report. */
  keyword_opportunities?: KeywordReportItem[]
}

export interface LeakReportInput {
  business_name: string
  industry:      string
  city:          string
  country:       string
  /** false → the business has no website at all (drives the no-website funnel). */
  has_website:   boolean
  rating:        number | null
  review_count:  number | null
  https_ok:      boolean | null
  tracking:      TrackingSignals | null
  breakdown:     ScoreSignal[] | null
  analysis:      ProspectAnalysis | null
  /**
   * P35.14: full 张骞 Discovery scan, when one was run for this prospect
   * (~$0.57, only for a small reviewed pilot batch — most prospects have
   * none of this and the report falls back to `analysis`/`breakdown` only).
   */
  discovery_report?:        DiscoveryReport | null
  /**
   * Distinguishes "never ran" from "ran but failed/truncated" — a null
   * `discovery_report` alone can't tell those apart (子牙 P35.14 review).
   */
  discovery_report_status?: 'not_run' | 'running' | 'completed' | 'truncated' | 'failed' | null
}

/** Singular, client-facing trade noun ("dentists" seed → "dentist"). */
function trade(industry: string): string {
  return INDUSTRY_LABELS[industry] ?? industry.replace(/_/g, ' ')
}
/** "gold_coast" → "Gold Coast" for a name that reads right in a sentence. */
function place(city: string): string {
  return city.split('_').map(w => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ')
}
/** "a dentist" / "an electrician" — the finding reads to a human, not a machine. */
function article(word: string): string {
  return /^[aeiou]/i.test(word.trim()) ? 'an' : 'a'
}

// ─── Stage builders (each pure, each grounded in real evidence) ───────────────

function stageFound(input: LeakReportInput, hasSignal: (s: string) => boolean): LeakStage {
  const base = { key: 'found' as const, label: 'Getting found',
    fix: 'Get you showing up in Google and AI search (ChatGPT, Perplexity) for what your customers actually type.' }
  const probe = input.analysis?.geo_probe
  const tradeLabel = trade(input.industry)
  if (probe && !probe.mentioned) {
    const rival = probe.competitors_mentioned[0]
    return { ...base, status: 'leak',
      finding: `When we asked ChatGPT for ${article(tradeLabel)} ${tradeLabel} in ${place(input.city)}, ${input.business_name} wasn't mentioned${rival ? ` — but ${rival} was` : ''}.` }
  }
  if (hasSignal('missing_title') || hasSignal('missing_description')) {
    return { ...base, status: 'weak',
      finding: `Your homepage is missing the basic tags Google reads to show you in results, so you rank lower than you should.` }
  }
  if (probe?.mentioned) {
    return { ...base, status: 'ok', finding: `You already turn up when people ask AI for ${article(tradeLabel)} ${tradeLabel} in ${place(input.city)}.` }
  }
  return { ...base, status: 'ok', finding: '' }
}

function stageTrust(input: LeakReportInput, hasSignal: (s: string) => boolean): LeakStage {
  const base = { key: 'trust' as const, label: 'First impression',
    fix: 'Lock down a secure, fast homepage that turns your reviews into visible proof the moment someone lands.' }
  if (input.https_ok === false) {
    return { ...base, status: 'leak',
      finding: `Your site loads without the padlock, so some browsers warn visitors it's "not secure" before they even see it.` }
  }
  if (hasSignal('slow_lcp')) {
    return { ...base, status: 'weak', finding: `Your homepage is slow to load on a phone — many people leave before it even opens.` }
  }
  if (hasSignal('thin_content')) {
    return { ...base, status: 'weak', finding: `Your homepage is thin on detail, so visitors don't get enough to feel confident calling.` }
  }
  const reviews = input.review_count ?? 0
  const rating = input.rating
  if (reviews >= 20 && rating) {
    return { ...base, status: 'ok', finding: `${reviews} reviews at ${rating}★ on a secure site — you make a strong first impression.` }
  }
  return { ...base, status: 'ok', finding: '' }
}

function stageContact(input: LeakReportInput): LeakStage {
  const base = { key: 'contact' as const, label: 'Getting in touch',
    fix: 'Add one-tap ways to reach you — enquiry form, click-to-call, and a WhatsApp button — so a ready customer never slips away.' }
  const t = input.tracking
  if (!t) return { ...base, status: 'ok', finding: '' }
  const noForm = !t.contact_form
  const noEmail = t.emails.length === 0
  if (noForm && noEmail) {
    return { ...base, status: 'leak',
      finding: `There's no enquiry form or visible email on your homepage — someone ready to get in touch has to hunt for a way to reach you.` }
  }
  if (noForm) {
    return { ...base, status: 'weak', finding: `There's no enquiry form on your homepage; visitors have to phone or dig for an email.` }
  }
  return { ...base, status: 'ok', finding: `You've got a clear way for visitors to get in touch.` }
}

function stageAlive(input: LeakReportInput): LeakStage {
  const base = { key: 'alive' as const, label: 'Looking open',
    fix: 'Keep your Facebook and Instagram alive with a steady stream of AI-made posts and video — with nothing to do at your end.' }
  const social = input.analysis?.social_activity
  const platform = social ? social.platform[0].toUpperCase() + social.platform.slice(1) : ''
  if (social && social.posts_last_30d === 0) {
    return { ...base, status: 'leak',
      finding: `Your ${platform} page hasn't posted in over a month — to a customer checking you out, that can read like you've closed.` }
  }
  if (social && social.posts_last_30d <= 3) {
    return { ...base, status: 'weak', finding: `Your ${platform} posts only now and then, so it doesn't build much momentum with customers.` }
  }
  if (social) {
    return { ...base, status: 'ok', finding: `Your ${platform} is active and posting regularly.` }
  }
  return { ...base, status: 'ok', finding: '' }
}

function stageEngine(input: LeakReportInput): LeakStage {
  const base = { key: 'engine' as const, label: 'Bringing leads in',
    fix: 'Switch on a lead engine: AI-made video ads that bring enquiries in, then automatic email and text follow-up so none go cold.' }
  const t = input.tracking
  if (!t) return { ...base, status: 'ok', finding: '' }
  const noMeasure = !t.ga4 && !t.gtm
  if (!t.meta_pixel && noMeasure) {
    return { ...base, status: 'leak',
      finding: `You've no ad tracking or visitor analytics installed — so no way to run measurable ads or see what works. Right now you're waiting for customers to find you, not going out to get them.` }
  }
  if (!t.meta_pixel) {
    return { ...base, status: 'weak',
      finding: `There's no ad pixel on your site, so you can't run or measure the video ads competitors use to pull in leads.` }
  }
  return { ...base, status: 'ok', finding: '' }
}

// ─── No-website funnel (the $99 one-page-site opportunity) ────────────────────

const SITE_FIX = 'A clean one-page site (from $99) so Google, AI and customers can actually find and reach you.'

function noWebsiteStages(input: LeakReportInput): [LeakStage, LeakStage, LeakStage] {
  const tradeLabel = trade(input.industry)
  return [
    { key: 'found', label: 'Getting found', status: 'leak', fix: SITE_FIX,
      finding: `You don't have a website yet — so when someone Googles you, or asks AI for ${article(tradeLabel)} ${tradeLabel} in ${place(input.city)}, there's nothing of yours to show.` },
    { key: 'trust', label: 'First impression', status: 'leak', fix: SITE_FIX,
      finding: `With no website, a new customer has nowhere to check you out and decide you're the one to call.` },
    { key: 'contact', label: 'Getting in touch', status: 'leak', fix: SITE_FIX,
      finding: `Someone who hears about you and looks online finds no site to enquire through — you're relying on them to already have your number.` },
  ]
}

// ─── P35.14: Discovery-sourced enrichment (whole-report gate, no field-level salvage) ─

const REGISTRY_SOURCE_LABEL: Record<'AU' | 'NZ', string> = {
  AU: 'Australian Business Register (ABR) — a public government registry, anyone can look this up',
  NZ: 'New Zealand Companies Office (NZBN) — a public government registry, anyone can look this up',
}

/**
 * Only a fully-completed, non-truncated Discovery report is trusted. A
 * truncated report can have e.g. `competitors` populated but `seed_keywords`
 * half-done — salvaging field-by-field would mix a complete section with an
 * incomplete one on the same page with no way to tell them apart, so the
 * whole report is discarded instead (子牙 P35.14 review).
 *
 * Exported so every consumer (this file's `buildLeakReport`, and
 * `/report/[id]/page.tsx`'s `siteWeak` check) shares ONE gate — a second,
 * hand-rolled copy of this condition drifts silently the moment this
 * function's logic changes (魏征 P35.14 implementation review).
 */
export function usableDiscovery(
  input: Pick<LeakReportInput, 'discovery_report' | 'discovery_report_status'>,
): DiscoveryReport | null {
  if (input.discovery_report_status !== 'completed') return null
  if (!input.discovery_report) return null
  if (input.discovery_report.meta?.truncated) return null
  return input.discovery_report
}

function buildIndustryBenchmark(discovery: DiscoveryReport): IndustryBenchmark | null {
  const values = (discovery.competitors ?? [])
    .map(c => c.monthly_traffic)
    .filter((v): v is number => v != null && v > 0)
  if (values.length === 0) return null
  return {
    your_traffic: discovery.semrush_snapshot?.monthly_traffic ?? null,
    industry_avg_traffic: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
    sample_size: values.length,
  }
}

function buildVerifiedRegistration(discovery: DiscoveryReport): VerifiedRegistration | null {
  const reg = discovery.business?.registration
  if (!reg || reg.status !== 'active') return null
  return {
    identifier_type: reg.identifier_type,
    registered_since: reg.registered_since,
    source_label: REGISTRY_SOURCE_LABEL[reg.country] ?? 'a public official business registry',
  }
}

function buildKeywordOpportunities(discovery: DiscoveryReport): KeywordReportItem[] {
  return (discovery.seed_keywords ?? [])
    .filter(k => (k.semrush_volume ?? k.estimated_volume ?? 0) > 0)
    .slice(0, 8)
    .map(k => ({
      phrase: k.keyword,
      volume: k.semrush_volume ?? k.estimated_volume ?? 0,
      difficulty: difficultyBand(k.semrush_kd ?? null),
    }))
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Build the customer-facing lead-leakage report. Pure — never throws, never invents. */
export function buildLeakReport(input: LeakReportInput): LeakReport {
  const breakdown = input.breakdown ?? []
  const hasSignal = (s: string) => breakdown.some(b => b.signal === s && b.kind === 'weakness')

  // No website at all → the first three funnel stages are leaks by definition
  // (nothing to find, no first impression, nowhere to enquire); social and
  // engine still read from real signals.
  const stages: LeakStage[] = input.has_website === false
    ? [...noWebsiteStages(input), stageAlive(input), stageEngine(input)]
    : [
        stageFound(input, hasSignal),
        stageTrust(input, hasSignal),
        stageContact(input),
        stageAlive(input),
        stageEngine(input),
      ]

  const leak_count = stages.filter(s => s.status === 'leak').length
  const weak_count = stages.filter(s => s.status === 'weak').length

  // Lead-health score: a hero number the owner reacts to. Each leaking stage
  // costs most, each soft spot a little. Deterministic — no invented weighting
  // beyond the funnel itself.
  const health_score = Math.max(0, 100 - leak_count * 18 - weak_count * 8)
  const verdict = health_score < 40 ? 'High leak risk'
    : health_score < 70 ? 'Leaking enquiries'
    : 'Fairly tight'

  // Email body: leaks first, then soft spots — sharpest evidence up top, capped
  // at 4 so the note stays scannable. Empty findings (unassessed stages) drop.
  const order: Record<LeakStatus, number> = { leak: 0, weak: 1, ok: 2 }
  const summary_points = [...stages]
    .filter(s => s.finding && s.status !== 'ok')
    .sort((a, b) => order[a.status] - order[b.status])
    .map(s => s.finding)
    .slice(0, 4)

  const headline = leak_count > 0
    ? `${leak_count} ${leak_count === 1 ? 'place' : 'places'} where enquiries are leaking`
    : 'A few quick wins to bring in more enquiries'

  const discovery = usableDiscovery(input)

  return {
    generated_at: new Date().toISOString(),
    business_name: input.business_name,
    headline,
    leak_count,
    health_score,
    verdict,
    stages,
    summary_points,
    industry_benchmark:    discovery ? buildIndustryBenchmark(discovery) : null,
    verified_registration: discovery ? buildVerifiedRegistration(discovery) : null,
    keyword_opportunities: discovery ? buildKeywordOpportunities(discovery) : [],
  }
}
