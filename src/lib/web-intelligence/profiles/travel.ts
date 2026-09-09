import type { BusinessContentProfile } from '../content-projection'

/** ME Travel page semantics. Customer domains and selected URLs stay in L4 configuration. */
export const TRAVEL_BUSINESS_PROFILE: BusinessContentProfile = {
  id: 'me-travel-v1',
  classifyPath(pathname) {
    if (/(?:^|\/)new-tours(?:\/|$)/.test(pathname)) return 'product_listing'
    if (/(?:^|\/)(?:special-offers?|offers?)(?:\/|$)/.test(pathname)) return 'offers'
    if (/(?:^|\/)tours\/[^/]+(?:\.html?)?$/.test(pathname)) return 'product_detail'
    if (/(?:^|\/)(?:tours|escorted-tours|private-tours)(?:\/|$)/.test(pathname)) return 'product_listing'
    return null
  },
}

export function profileForTags(tags: readonly string[]): BusinessContentProfile | undefined {
  return tags.includes('industry:travel') ? TRAVEL_BUSINESS_PROFILE : undefined
}

