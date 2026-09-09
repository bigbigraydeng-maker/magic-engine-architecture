import type { BusinessContentProfile, BusinessPageRole } from '../content-projection'

const PRICE = /^(\d+)\s+days?\s+from\s+(.+?)(?:\s*)$/i
const IGNORE_TITLE = /^(?:\*|display map|view tour|early bird sale)$/i

type TourRecord = {
  name: string
  durationDays: number
  price: string
  promotion: string
  reviews: string
  includes: string
  route: string
}

const clean = (value: string) => value.trim().replace(/^[*#-]+\s*/, '').replace(/\s+/g, ' ')

function precedingTitle(lines: string[], priceIndex: number): string | null {
  for (let index = priceIndex - 1; index >= Math.max(0, priceIndex - 4); index--) {
    const candidate = clean(lines[index] ?? '')
    if (candidate && !IGNORE_TITLE.test(candidate)) return candidate
  }
  return null
}

function followingValue(lines: string[], priceIndex: number, pattern: RegExp): string {
  return lines.slice(priceIndex + 1, priceIndex + 5).map(clean).find(line => pattern.test(line)) ?? 'not stated'
}

function routeValue(lines: string[], priceIndex: number): string {
  return lines.slice(priceIndex + 1, priceIndex + 6).map(clean).find(line =>
    line && !/^(?:\d+ reviews?|includes |view tour)/i.test(line),
  ) ?? 'not stated'
}

export function extractTourRecords(raw: string): TourRecord[] {
  const lines = raw.replace(/\r\n/g, '\n').split('\n').map(line => line.trim()).filter(Boolean)
  const records = lines.flatMap((line, index): TourRecord[] => {
    const match = clean(line).match(PRICE)
    const name = match ? precedingTitle(lines, index) : null
    if (!match || !name) return []
    const nearby = lines.slice(Math.max(0, index - 4), index).map(clean)
    return [{
      name,
      durationDays: Number(match[1]),
      price: clean(match[2]),
      promotion: nearby.some(value => /^early bird sale$/i.test(value)) ? 'EARLY BIRD SALE' : 'none',
      reviews: followingValue(lines, index, /^\d+ reviews?$/i),
      includes: followingValue(lines, index, /^includes /i),
      route: routeValue(lines, index),
    }]
  })
  return records.sort((a, b) => a.name.localeCompare(b.name, 'en-NZ'))
}

export function projectTravelContent(raw: string, role: BusinessPageRole): string | null {
  if (role !== 'product_listing' && role !== 'offers') return null
  const records = extractTourRecords(raw)
  if (records.length === 0) return null
  return records.map(record => [
    `Tour: ${record.name}`,
    `Duration: ${record.durationDays} days`,
    `Price: ${record.price}`,
    `Promotion: ${record.promotion}`,
    `Reviews: ${record.reviews}`,
    `Includes: ${record.includes}`,
    `Route: ${record.route}`,
  ].join(' | ')).join('\n')
}

export const TRAVEL_INTERPRETATION_GUIDANCE = `The evidence contains canonical Tour records. Compare Tour competitiveness by named Tour and exact fields only: product presence, price, promotion, duration, route or destinations, departure dates, availability, inclusions, positioning and reviews. State the exact Tour name plus before and after values. Never infer that a promotion moved or disappeared from an unassociated repeated label. If no named Tour has a verifiable field change, classify ignore and state that no reliable Tour change was found.`

/** ME Travel page semantics. Customer domains and selected URLs stay in L4 configuration. */
export const TRAVEL_BUSINESS_PROFILE: BusinessContentProfile = {
  id: 'me-travel-v2',
  classifyPath(pathname) {
    if (/(?:^|\/)new-tours(?:\/|$)/.test(pathname)) return 'product_listing'
    if (/(?:^|\/)(?:special-offers?|offers?)(?:\/|$)/.test(pathname)) return 'offers'
    if (/(?:^|\/)tours\/[^/]+(?:\.html?)?$/.test(pathname)) return 'product_detail'
    if (/(?:^|\/)(?:tours|escorted-tours|private-tours)(?:\/|$)/.test(pathname)) return 'product_listing'
    return null
  },
  projectContent: projectTravelContent,
  interpretationGuidance: TRAVEL_INTERPRETATION_GUIDANCE,
}

export function profileForTags(tags: readonly string[]): BusinessContentProfile | undefined {
  return tags.includes('industry:travel') ? TRAVEL_BUSINESS_PROFILE : undefined
}
