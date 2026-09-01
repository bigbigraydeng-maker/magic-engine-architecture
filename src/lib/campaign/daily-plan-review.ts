import { createHash } from 'crypto'
import type {
  CampaignDailyBundle,
  CampaignDailyDay,
  CampaignDailyPlanData,
} from './daily-plan'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export interface CampaignDailyRefreshMeta {
  start_date: string
  end_date: string
  original_dates: string[]
  applied_at: string
}

export type RefreshedCampaignDailyPlan = CampaignDailyPlanData & {
  refresh_meta: CampaignDailyRefreshMeta
}

export function isRealIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function addCalendarDays(value: string, days: number): string {
  if (!isRealIsoDate(value)) throw new Error(`INVALID_DATE:${value}`)
  const parsed = new Date(`${value}T00:00:00.000Z`)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

export function dateInTimeZone(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

export function assertCompleteConsecutiveWindow(
  days: CampaignDailyDay[],
  bundles: CampaignDailyBundle[],
): void {
  if (days.length !== 7 || bundles.length !== 7) {
    throw new Error('PLAN_NOT_HANDOFF_READY')
  }

  const bundleByDate = new Map(bundles.map(bundle => [bundle.date, bundle]))
  for (let index = 0; index < days.length; index += 1) {
    const expected = index === 0 ? days[0]?.date : addCalendarDays(days[0].date, index)
    if (!isRealIsoDate(days[index].date) || days[index].date !== expected) {
      throw new Error('PLAN_DATES_NOT_CONSECUTIVE')
    }
    if (!bundleByDate.has(days[index].date)) {
      throw new Error('PLAN_NOT_HANDOFF_READY')
    }
  }
}

export function refreshCampaignDailyPlan(
  plan: CampaignDailyPlanData,
  startDate: string,
  appliedAt: string,
): RefreshedCampaignDailyPlan {
  if (!isRealIsoDate(startDate)) throw new Error('INVALID_START_DATE')
  assertCompleteConsecutiveWindow(plan.days, plan.bundles)

  const bundleByDate = new Map(plan.bundles.map(bundle => [bundle.date, bundle]))
  const originalDates = plan.days.map(day => day.date)
  const days = plan.days.map((day, index) => ({
    ...day,
    date: addCalendarDays(startDate, index),
  }))
  const bundles = plan.days.map((day, index) => ({
    ...bundleByDate.get(day.date)!,
    date: addCalendarDays(startDate, index),
  }))

  return {
    ...plan,
    days,
    bundles,
    refresh_meta: {
      start_date: startDate,
      end_date: addCalendarDays(startDate, 6),
      original_dates: originalDates,
      applied_at: appliedAt,
    },
  }
}

/**
 * UUIDv5-shaped deterministic identity backed by SHA-1. The stable primary
 * key is the concurrency/idempotency lock; no query-then-insert race exists.
 */
export function deterministicReviewUuid(kind: 'post' | 'image', stableKey: string): string {
  const bytes = createHash('sha1')
    .update(`magic-engine:campaign-daily-review:${kind}:${stableKey}`)
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function campaignDailyReviewStableKey(params: {
  clientId: string
  planId: string
  planRevision: string
  dayIndex: number
}): string {
  // social_plans updates in place, so planId alone is not a content identity.
  // Include the immutable command revision (but never the refreshed date):
  // retrying one command stays idempotent, while a genuinely new content
  // command receives a fresh seven-row review set.
  return `${params.clientId}|${params.planId}|${params.planRevision}|campaign_daily_v1|${params.dayIndex}`
}
