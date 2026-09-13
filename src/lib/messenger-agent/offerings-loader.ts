/**
 * Offerings fact layer loader (Issue #1577).
 *
 * `config/clients/<clientId>/offerings.yaml` is the PM/FDE-maintained, hand-edited
 * source of truth for what a client is actually selling right now. This loader is
 * the ONLY supported way to read it: parse YAML, validate with Zod, cache in memory
 * for 5 minutes so the reply agent and the Verifier don't re-hit the filesystem on
 * every message.
 *
 * Why this exists: the incident that started the CTS Governed Reply project was
 * Meta's official AI reading a still-live website page and telling a customer a
 * retired tour was bookable. This file is the governance layer's only source of
 * "is this tour actually for sale" — the Agent reasoning layer (Issue F) and the
 * Verifier policy (Issue D) both read through here instead of trusting the website
 * or the model's own training knowledge.
 *
 * Platform note: this loader is client-agnostic (`clientId` — a DB `client_id`,
 * mapped to a config directory slug — picks the YAML file) — only
 * `config/clients/<slug>/offerings.yaml` itself is client-specific data.
 * `clientId` has no default: this is a shared, multi-client entry point, so a
 * caller that omits it must fail loudly instead of silently reading another
 * client's facts.
 */

import { promises as fs } from 'fs'
import path from 'path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

// ─── Schema ─────────────────────────────────────────────────────────────────

/**
 * Accepts ISO 8601 dates/timestamps (plain "2026-11-16" dates and full ISO
 * instants alike) — offerings.yaml is hand-edited by non-engineers, so typos
 * are expected. `Date.parse` alone is not enough: Node normalizes
 * out-of-range days (e.g. "2026-02-30" silently becomes March 2), which would
 * let a nonexistent departure date reach the fact layer and be quoted to a
 * customer. This re-checks the year/month/day round-trip through
 * `Date.UTC` to reject calendar dates that don't actually exist.
 */
const dateLikeString = z.string().min(1).refine((value) => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return false
  if (Number.isNaN(Date.parse(value))) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const roundTrip = new Date(Date.UTC(year, month - 1, day))
  return (
    roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() === month - 1 &&
    roundTrip.getUTCDate() === day
  )
}, {
  message:
    'must be a valid calendar date in ISO format (e.g. "2026-11-16" or an ISO 8601 timestamp) — dates that do not exist (e.g. "2026-02-30") are rejected',
})

// Every object schema below is `.strict()` (Codex review, PR #1626): a plain
// z.object() silently drops unknown keys and lets a missing real field fall
// back to its `.default([])`. A hand-edited YAML typo like `retired_tour:`
// instead of `retired_tours:` would then parse "successfully" with an empty
// retired list — silently erasing the exact safety data this file exists to
// hold — instead of failing CI the way the loader tests already claim it does.

export const ActiveTourSchema = z
  .object({
    code: z.string().min(1),
    name: z.string().min(1),
    aliases: z.array(z.string()).default([]),
    price_nzd: z.number().positive(),
    departure_dates: z.array(dateLikeString).min(1),
    nights: z.number().int().positive(),
    itinerary_url: z.string().url(),
    highlights: z.array(z.string()).default([]),
  })
  .strict()

export const RetiredTourSchema = z
  .object({
    code: z.string().min(1),
    name: z.string().min(1),
    aliases: z.array(z.string()).default([]),
    retired_reason: z.string().min(1),
    /**
     * True when the marketing page for a retired tour is still live on the
     * client's website — the exact trap that caused Meta's AI to misreport a
     * retired tour as bookable. Optional because it may be unknown/unverified
     * at the time an entry is added.
     */
    still_visible_on_website: z.boolean().optional(),
  })
  .strict()

export const OfferingsFileSchema = z
  .object({
    active_tours: z.array(ActiveTourSchema).default([]),
    retired_tours: z.array(RetiredTourSchema).default([]),
    /** Hard facts the reply agent may state verbatim (company history, visa rules, etc). */
    factual_bullets: z.array(z.string()).default([]),
    /**
     * Topics the reply agent must never answer directly, independent of
     * `master_briefs.excluded_topics` (that field is about content/brand voice,
     * this one is about what the Governed Reply Agent is allowed to say at all).
     */
    reply_forbidden_topics: z.array(z.string()).default([]),
    /**
     * When this file was last checked against reality. Kept as a plain string
     * (not auto-generated) so PM/FDE editing the YAML by hand can see and update
     * it directly. A downstream daily-todo reminder (Issue O) flags this file
     * once it is more than 7 days old — this loader only exposes the field.
     */
    last_verified_at: dateLikeString,
  })
  .strict()

export type ActiveTour = z.infer<typeof ActiveTourSchema>
export type RetiredTour = z.infer<typeof RetiredTourSchema>
export type OfferingsFile = z.infer<typeof OfferingsFileSchema>

// ─── Loader ─────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000

/** Injectable clock so tests can control cache expiry without real sleeps or timer mocks. */
export interface Clock {
  now(): number
}

const systemClock: Clock = { now: () => Date.now() }

interface CacheEntry {
  filePath: string
  data: OfferingsFile
  loadedAt: number
}

let cache: CacheEntry | null = null

/**
 * `conversations.client_id` is a DB UUID (e.g. CTS is
 * `c0000000-0000-0000-0000-000000000000`), but `config/clients/*` directories
 * use human-readable slugs so PM/FDE can find and edit them by hand. This is
 * the one explicit, stable mapping between the two — callers must never
 * assume a DB client_id doubles as a directory slug.
 */
const CLIENT_ID_TO_CONFIG_SLUG: Record<string, string> = {
  'c0000000-0000-0000-0000-000000000000': 'cts',
}

export function offeringsPathFor(clientId: string): string {
  const slug = CLIENT_ID_TO_CONFIG_SLUG[clientId] ?? clientId
  return path.join(process.cwd(), 'config', 'clients', slug, 'offerings.yaml')
}

export interface LoadOfferingsOptions {
  /**
   * Required unless `filePath` is given. This is a DB `client_id`
   * (`conversations.client_id`), resolved to a config slug via
   * `CLIENT_ID_TO_CONFIG_SLUG`. There is no default — this loader backs a
   * shared, multi-client Agent/Verifier entry point, so a caller that forgot
   * to pass a client must fail loudly instead of silently reading (and then
   * quoting) another client's private tour facts.
   */
  clientId?: string
  /** Overrides the computed `config/clients/<slug>/offerings.yaml` path — mainly for tests. */
  filePath?: string
  /** Skip the in-memory cache and re-read + re-validate the file. */
  forceRefresh?: boolean
  /** Injectable clock — mainly for tests. Defaults to the real system clock. */
  clock?: Clock
}

/**
 * Load, validate, and cache a client's offerings.yaml.
 *
 * Throws if `clientId`/`filePath` are both missing, the file is missing, or
 * it fails Zod validation — callers (Agent tool layer, Verifier policy) must
 * treat a throw as "fact layer unavailable" and fail closed (do not let the
 * model answer tour-availability questions from its own knowledge, and never
 * fall back to a different client's facts), not silently fall back to no
 * facts at all.
 */
export async function loadOfferings(options: LoadOfferingsOptions = {}): Promise<OfferingsFile> {
  let filePath = options.filePath
  if (!filePath) {
    if (!options.clientId) {
      throw new Error(
        'loadOfferings requires clientId (or filePath) — refusing to guess a client, ' +
          'since that could leak one client\'s tour facts into another client\'s reply',
      )
    }
    filePath = offeringsPathFor(options.clientId)
  }
  const clock = options.clock ?? systemClock
  const now = clock.now()

  if (
    !options.forceRefresh &&
    cache &&
    cache.filePath === filePath &&
    now - cache.loadedAt < CACHE_TTL_MS
  ) {
    return cache.data
  }

  const raw = await fs.readFile(filePath, 'utf8')
  const parsed = parseYaml(raw)
  const data = OfferingsFileSchema.parse(parsed)

  cache = { filePath, data, loadedAt: now }
  return data
}

/** Test-only escape hatch — clears the module-level cache between test cases. */
export function __clearOfferingsCacheForTests(): void {
  cache = null
}
