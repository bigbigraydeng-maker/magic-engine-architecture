/**
 * CTS Tours NZ verifier policy — the seven gates a Governed Reply Agent draft
 * must clear before a human (Ray/FDE) is even shown it for approval (Issue
 * #1579, L4 客户专属 — do not import this from anywhere that is meant to stay
 * client-agnostic; see `../framework.ts` for the generic shell this plugs into).
 *
 * ## Cross-issue contract this file depends on (Issue #1580, in flight in a
 * parallel session as of 2026-09-13)
 *
 * The Agent's output shape is `{ reply_text, confidence, offerings: { name,
 * code }[] }` — `offerings` is a **paired** array, not two parallel arrays of
 * names and codes. The provenance gate below relies on that pairing to check
 * name↔code correspondence one entry at a time; if #1580 ships a different
 * shape, `CtsAgentOutput` here must be updated to match (and the provenance
 * gate rewritten) rather than one side silently drifting from the other.
 *
 * ## Why every gate collects, and none of them talk to the database
 *
 * All seven gates here are pure functions of `CtsVerifierContext` — the caller
 * (the reply-send pipeline) is responsible for fetching `brand_redline_phrases`
 * and `loadOfferings()` first and handing them in. That mirrors the pattern
 * already established in `classify.ts` (`PostSaleClassificationPolicy`) and
 * `offerings-loader.ts` fail-closed loading: a policy file should be trivially
 * testable with plain objects, and the caller — not this file — owns "what do
 * I do when a DB read fails" (answer, per CLAUDE.md 铁律: fail closed, never
 * silently fall back to "no redlines" / "no canonical facts").
 */

import { containsPhrase, normalizeAngle } from '@/lib/factory/strategist'
import type { OfferingsFile } from '../../offerings-loader'
import type { Gate, VerifierResult } from '../framework'
import { runVerifierGates } from '../framework'

// ─── Identity guard ─────────────────────────────────────────────────────────

/**
 * CTS Tours NZ's `clients.id` (see CLAUDE.md 客户 ID 索引). This policy file is
 * CTS-specific by construction — every gate below reads CTS's own canonical
 * facts and redline phrases — so `verifyCtsReply` refuses to run any gate at
 * all when the context's `clientId` does not match this constant. Without
 * this check, a wiring bug that accidentally paired CTS's policy with another
 * client's conversation data would run CTS's brand-redline phrases and tour
 * canon against, say, a real-estate client's draft reply — passing gates that
 * mean nothing for that client's actual facts, and missing the ones that do.
 */
export const CTS_CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'

/** `config/clients/<configSlug>` directory name — see `offerings-loader.ts`. */
export const CTS_CONFIG_SLUG = 'cts'

// ─── Agent output contract (Issue #1580) ───────────────────────────────────

export interface CtsAgentOfferingReference {
  name: string
  code: string
}

export interface CtsAgentOutput {
  reply_text: string
  confidence: number
  offerings: CtsAgentOfferingReference[]
}

export interface CtsVerifierContext {
  /** The conversation's actual `clients.id` — must equal `CTS_CLIENT_ID`. */
  clientId: string
  agentOutput: CtsAgentOutput
  /** `clients.brand_redline_phrases` for this conversation's client. */
  brandRedlinePhrases: string[]
  /** `loadOfferings({ configSlug: CTS_CONFIG_SLUG })` result. */
  canonical: OfferingsFile
}

// ─── Gate 1 · Brand redline ─────────────────────────────────────────────────

/**
 * Reuses `containsPhrase` from `src/lib/factory/strategist.ts` (exported for
 * this file in the same PR — see that file's comment) so brand-redline
 * matching semantics stay identical between the Content Factory and the
 * Governed Reply Agent instead of two independently-drifting implementations
 * of "does this text contain that phrase."
 */
function brandRedlineGate(): Gate<CtsVerifierContext> {
  return {
    id: 'brand_redline',
    check(ctx) {
      const text = ctx.agentOutput.reply_text
      for (const phrase of ctx.brandRedlinePhrases) {
        if (phrase && containsPhrase(text, phrase)) {
          return `reply contains brand-redline phrase "${phrase}"`
        }
      }
      return null
    },
  }
}

// ─── Gate 2 · Retired tour mention ──────────────────────────────────────────

function retiredTourMentionGate(): Gate<CtsVerifierContext> {
  return {
    id: 'retired_tour_mention',
    check(ctx) {
      const text = ctx.agentOutput.reply_text
      for (const tour of ctx.canonical.retired_tours) {
        const namesToCheck = [tour.name, ...tour.aliases]
        for (const name of namesToCheck) {
          if (name && containsPhrase(text, name)) {
            return `reply mentions retired tour "${tour.name}" (code=${tour.code})`
          }
        }
      }
      return null
    },
  }
}

// ─── Gate 3 · Number claim (price / date must be verifiable) ───────────────

/**
 * MVP extraction, scoped to what the reply agent is expected to produce
 * verbatim from canonical facts: `$1,234` / `NZ$1234(.56)` style price
 * mentions, and ISO `YYYY-MM-DD` date mentions (the exact format
 * `offerings.yaml` stores in `departure_dates`, per `offerings-loader.ts`'s
 * `dateLikeString`). A reply that spells a date out in prose ("16 November
 * 2026") is a known gap this gate does not catch — flagged here rather than
 * silently assumed covered; tightening this is future work once the dry-run
 * (Issue P) shows what formats the Agent actually produces.
 */
const PRICE_MENTION_RE = /(?:NZ\$|\$)\s?([\d,]+(?:\.\d{1,2})?)/gi
const ISO_DATE_MENTION_RE = /\b\d{4}-\d{2}-\d{2}\b/g

function extractPriceMentions(text: string): number[] {
  const out: number[] = []
  for (const match of text.matchAll(PRICE_MENTION_RE)) {
    const n = Number(match[1].replace(/,/g, ''))
    if (Number.isFinite(n)) out.push(n)
  }
  return out
}

function extractIsoDateMentions(text: string): string[] {
  return [...text.matchAll(ISO_DATE_MENTION_RE)].map((m) => m[0])
}

function numberClaimGate(): Gate<CtsVerifierContext> {
  return {
    id: 'number_claim',
    check(ctx) {
      const activeTours = ctx.canonical.active_tours
      const validPrices = new Set(activeTours.map((t) => t.price_nzd))
      const validDates = new Set(
        activeTours.flatMap((t) => t.departure_dates.map((d) => d.slice(0, 10)))
      )

      const text = ctx.agentOutput.reply_text
      for (const price of extractPriceMentions(text)) {
        if (!validPrices.has(price)) {
          return `reply states price "$${price}" that does not match any active tour's price_nzd`
        }
      }
      for (const date of extractIsoDateMentions(text)) {
        if (!validDates.has(date)) {
          return `reply states date "${date}" that does not match any active tour's departure_dates`
        }
      }
      return null
    },
  }
}

// ─── Gate 4 · Reply forbidden topics ────────────────────────────────────────

/**
 * Independent from `master_briefs.excluded_topics` (that field is a content/
 * brand-voice concern for the Content Factory) — `reply_forbidden_topics` is
 * about what the Governed Reply Agent is allowed to say at all, per
 * `offerings-loader.ts`'s field comment.
 */
function replyForbiddenTopicsGate(): Gate<CtsVerifierContext> {
  return {
    id: 'reply_forbidden_topic',
    check(ctx) {
      const text = ctx.agentOutput.reply_text
      for (const topic of ctx.canonical.reply_forbidden_topics) {
        if (topic && containsPhrase(text, topic)) {
          return `reply touches forbidden topic "${topic}"`
        }
      }
      return null
    },
  }
}

// ─── Gate 5 · Provenance (name↔code one-to-one mapping) ────────────────────

/**
 * v3 补丁#8: this must check that each `{name, code}` pair in
 * `agentOutput.offerings` refers to the SAME active tour — not merely that
 * `name` appears somewhere in the whitelist and `code` appears somewhere in
 * the whitelist independently. The attack this closes: an agent hallucinating
 * `{ name: "<a real tour's name>", code: "<a different, fabricated code>" }`
 * would pass a "are these N names and N codes both in the allowed sets"
 * check, but must fail here.
 */
function provenanceGate(): Gate<CtsVerifierContext> {
  return {
    id: 'provenance',
    check(ctx) {
      const activeTours = ctx.canonical.active_tours
      for (const ref of ctx.agentOutput.offerings) {
        const normalizedRefName = normalizeAngle(ref.name)
        const matchedTour = activeTours.find((tour) => {
          const candidateNames = [tour.name, ...tour.aliases]
          return candidateNames.some((name) => normalizeAngle(name) === normalizedRefName)
        })
        if (!matchedTour) {
          return `offering name "${ref.name}" does not match any active tour's name or aliases`
        }
        if (matchedTour.code !== ref.code) {
          return `offering name "${ref.name}" resolves to tour code "${matchedTour.code}", but reply claims code "${ref.code}"`
        }
      }
      return null
    },
  }
}

// ─── Gate 6 · Length ─────────────────────────────────────────────────────────

/**
 * 1800 is the stricter of the two channels' message-length limits (Messenger
 * vs WhatsApp) — this constant intentionally stays a single shared value.
 * Do NOT "optimize" this into a per-channel threshold without re-reading the
 * v3 plan: the whole point of taking the stricter number is that a draft
 * approved once must be safe to send on either channel without re-checking,
 * and per-channel thresholds would silently reopen that gap. Real boundary
 * validation against each channel's actual limit is tracked separately
 * (Issue P dry-run), not this gate.
 */
const MAX_REPLY_LENGTH = 1800

function lengthGate(): Gate<CtsVerifierContext> {
  return {
    id: 'length',
    check(ctx) {
      const len = ctx.agentOutput.reply_text.length
      if (len > MAX_REPLY_LENGTH) {
        return `reply is ${len} characters, exceeds the ${MAX_REPLY_LENGTH}-character limit`
      }
      return null
    },
  }
}

// ─── Gate 7 · URL allowlist ──────────────────────────────────────────────────

const URL_RE = /https?:\/\/[^\s)\]}>,;'"]+/gi

/** Trim trailing sentence punctuation a URL regex over-matches (e.g. "...nz.") */
function stripTrailingPunctuation(url: string): string {
  return url.replace(/[.,;:!?]+$/, '')
}

function extractUrls(text: string): string[] {
  return [...text.matchAll(URL_RE)].map((m) => stripTrailingPunctuation(m[0]))
}

/**
 * `canonical.active_tours[].itinerary_url`'s hosts are allowed dynamically —
 * PM/FDE can add a new tour with a new itinerary page without a code change
 * here (issue #1579 v3 补丁#5).
 */
function buildAllowedHosts(canonical: OfferingsFile): Set<string> {
  const hosts = new Set<string>(['ctstours.co.nz', 'immigration.govt.nz'])
  for (const tour of canonical.active_tours) {
    try {
      const host = new URL(tour.itinerary_url).hostname.toLowerCase().replace(/^www\./, '')
      hosts.add(host)
    } catch {
      // itinerary_url already passed Zod's z.string().url() at load time; this
      // catch only guards against a future schema relaxation, and simply
      // contributes no host rather than crashing the whole gate.
    }
  }
  return hosts
}

/**
 * `google.com/maps` in the spec means "Google Maps links," not "any
 * google.com URL" — a bare `google.com/search?...` link must still be
 * blocked. `maps.google.com` (the host Google Maps share links actually use)
 * is allowed on any path.
 */
function isUrlAllowed(rawUrl: string, allowedHosts: ReadonlySet<string>): boolean {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return false
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  if (host === 'maps.google.com') return true
  if (host === 'google.com') return parsed.pathname.startsWith('/maps')
  return allowedHosts.has(host)
}

function urlAllowlistGate(): Gate<CtsVerifierContext> {
  return {
    id: 'url_allowlist',
    check(ctx) {
      const allowedHosts = buildAllowedHosts(ctx.canonical)
      const badUrls = extractUrls(ctx.agentOutput.reply_text).filter(
        (url) => !isUrlAllowed(url, allowedHosts)
      )
      if (badUrls.length > 0) {
        return `reply contains URL(s) outside the approved allowlist: ${badUrls.join(', ')}`
      }
      return null
    },
  }
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

export const ctsVerifierGates: ReadonlyArray<Gate<CtsVerifierContext>> = [
  brandRedlineGate(),
  retiredTourMentionGate(),
  numberClaimGate(),
  replyForbiddenTopicsGate(),
  provenanceGate(),
  lengthGate(),
  urlAllowlistGate(),
]

/**
 * Entry point the reply-send pipeline calls. Aborts before running any gate
 * when `clientId` does not match `CTS_CLIENT_ID` — see the identity-guard
 * comment above. This mismatch is reported through the same
 * `VerifierResult` shape (not a thrown error) so callers have exactly one
 * result contract to handle, but it is never a false "ok: false because a
 * gate found a problem" — the `blocked_reasons` entry names the mismatch
 * explicitly so this can't be confused with a content problem.
 */
export function verifyCtsReply(context: CtsVerifierContext): VerifierResult {
  if (context.clientId !== CTS_CLIENT_ID) {
    return {
      ok: false,
      blocked_reasons: [
        `client_id_mismatch: this policy is CTS-only (expected ${CTS_CLIENT_ID}), got "${context.clientId}"`,
      ],
      require_human_confirm: true,
    }
  }
  return runVerifierGates(ctsVerifierGates, context)
}
