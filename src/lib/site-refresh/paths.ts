/**
 * Given a list of files touched by a customer-site push, decide
 * whether the push affects the public site at all, and (if so) which
 * bucket it hits (tour data / blog data / schema-shared).
 *
 * This is intentionally lightweight and platform-shared — it does NOT
 * know the concrete list of published URLs for any particular customer.
 * The concrete URL list is provided by the caller (registry payload or
 * client-specific config).
 *
 * Not registering a specific file pattern here means we simply don't
 * fire a refresh for that push. We prefer over-purging on ambiguity
 * to under-purging.
 */

export interface SiteRefreshPlan {
  readonly hasSiteChange: boolean
  readonly tourDataChanged: boolean
  readonly blogDataChanged: boolean
  readonly reasons: readonly string[]
}

const TOURS_DATA_RE = /^src\/lib\/data\/tours\.ts$/
const BLOG_DATA_RE = /^src\/lib\/data\/blogs.*\.ts$/
const CAMPAIGNS_RE = /^src\/lib\/campaigns\//
const APP_ROUTES_RE = /^src\/app\/(tours|blog|china-tours|campaigns)\//
const SCHEMA_RE = /^src\/lib\/(schema-tour|seo-metadata|site-media)\.ts$/

export function planSiteRefresh(changedFiles: readonly string[]): SiteRefreshPlan {
  const reasons: string[] = []
  let tourDataChanged = false
  let blogDataChanged = false

  for (const f of changedFiles) {
    if (TOURS_DATA_RE.test(f)) {
      tourDataChanged = true
      reasons.push(`tour-data:${f}`)
    } else if (BLOG_DATA_RE.test(f)) {
      blogDataChanged = true
      reasons.push(`blog-data:${f}`)
    } else if (CAMPAIGNS_RE.test(f)) {
      tourDataChanged = true
      reasons.push(`campaign:${f}`)
    } else if (SCHEMA_RE.test(f)) {
      tourDataChanged = true
      blogDataChanged = true
      reasons.push(`schema:${f}`)
    } else if (APP_ROUTES_RE.test(f)) {
      tourDataChanged = true
      blogDataChanged = true
      reasons.push(`app-route:${f}`)
    }
  }

  return {
    hasSiteChange: tourDataChanged || blogDataChanged,
    tourDataChanged,
    blogDataChanged,
    reasons,
  }
}

/**
 * Compute the concrete list of paths to refresh, given the plan and
 * the site's URL inventory. The caller supplies each bucket's URL list
 * so this module stays customer-agnostic.
 */
export interface SiteUrlInventory {
  readonly tourPaths: readonly string[]
  readonly blogPaths: readonly string[]
}

export function pathsFromPlan(
  plan: SiteRefreshPlan,
  inventory: SiteUrlInventory,
): readonly string[] {
  const out: string[] = []
  if (plan.tourDataChanged) out.push(...inventory.tourPaths)
  if (plan.blogDataChanged) out.push(...inventory.blogPaths)
  return Array.from(new Set(out))
}

/**
 * CTS Tours current published URL inventory. This is the ONE customer-
 * specific hardcode in the ME repo — small enough to be worth it, and
 * future customer sites should either add their own inventory constant
 * next to this one or (better) declare it in client_site_platforms.
 */
export const CTS_TOURS_INVENTORY: SiteUrlInventory = {
  tourPaths: [
    '/tours/china/discovery/essentials',
    '/tours/china/discovery/beijing-xian',
    '/tours/china/discovery/shanghai-surroundings',
    '/tours/china/discovery/golden-china',
    '/tours/china/discovery/tale-of-two-cities',
    '/tours/china/signature/imperial-heritage',
    '/tours/china/signature/silk-road',
  ],
  blogPaths: [
    '/blog/beijing-xian-itinerary-10-days',
    '/blog/shanghai-suzhou-hangzhou-itinerary',
    '/blog/holidays-to-china-from-new-zealand',
    '/blog/china-tour-packages-including-airfare-from-nz',
  ],
} as const

const INVENTORY_BY_REPO: Record<string, SiteUrlInventory> = {
  'bigbigraydeng-maker/chinatravel': CTS_TOURS_INVENTORY,
}

/** Look up a customer's URL inventory by GitHub repo full name. */
export function getInventoryForRepo(githubRepo: string): SiteUrlInventory | null {
  return INVENTORY_BY_REPO[githubRepo] ?? null
}
